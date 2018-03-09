Polymer({
    is: 'voyent-my-locations',
    behaviors: [Voyent.AlertMapBehaviour, Voyent.AlertBehaviour, Voyent.TooltipBehaviour],

    properties: {
        /**
         * Indicates whether the component is loaded on mobile.
         */
        isMobile: { type: Boolean, value: false },
        /**
         * Indicates whether the component is in portrait mode. Applicable only when isMobile is true.
         */
        isPortrait: { type: Boolean, value: false, observer: '_isPortraitChanged' }

    },

    attached: function() {
        this.querySelector('#placesSearchValidator').validate = this._validatePlacesSearch.bind(this);
        this.querySelector('#locationNameValidator').validate = this._validateDialogLocationName.bind(this);
    },

    ready: function() {
        var _this = this;
        //An array of MyLocations, represents the saved locations currently on the map.
        this.set('_myLocations',[]);
        //The location that is currently active in the editor (infoWindow is displayed).
        this._loadedLocation = null;
        //An object containing details of the last Google Place search result (after clicking a place icon on map).
        this._selectedPlace = null;
        //An object containing details of the a newly created pin drop location.
        this._pinDropLocation = null;
        //A flag indicating if the loaded location should be updated, used after info window closures.
        this._locationUpdatePending = false;
        //A flag for counting the keypresses to the autocomplete entry so we can reset state as necessary.
        this._autocompleteKeyupCount = 0;
        //Padding to apply to the tooltip, represents the VRAS app header height.
        this._tooltipPadding = 64;
        //Set the values of the map tooltip positioning as it changes for the various view options and set our displayed toggle.
        this._mapTooltipDesktopPos = 'centered-top';
        this._mapTooltipPortraitPos = 'centered-bottom';
        this._mapTooltipLandscapePos = 'left-top';
        this._tooltipsDisplayed = true;
        //A flag used to ignore change listener events for the location name input.
        this._ignoreInputNameChanged = false;
        //Initialize other pieces that depend on the map.
        this._mapIsReady().then(function() {
            //Setup the infoWindow.
            _this._setupInfoWindow();
            //Initialize places service for later.
            _this._placesService = new google.maps.places.PlacesService(_this._map);
            //Specify that we want to skip panning to the region boundary
            //as we'll conditionally pan in the promises callback.
            _this._skipRegionPanning = true;
            //Fetch the realm region and the previously created locations. After we have them
            //both adjust the bounds based on whether we retrieved any location records.
            var promises = [];
            promises.push(_this._fetchRealmRegion());
            promises.push(_this._fetchMyLocations());
            Promise.all(promises).then(function() {
                _this._adjustBoundsAndPan();
            });
        });
    },

    observers: ['_myLocationsUpdated(_myLocations.length)','_inputNameChanged(_inputName)'],

    //******************PRIVATE API******************

    /**
     * Finish initializing after login.
     * @private
     */
    _onAfterLogin: function () {
        this._addCustomControls();
    },

    /**
     * Saves all locations that have been modified since component load or last save.
     * @param locationToSave
     * @param msgPrefix
     * @private
     */
    _saveLocation: function(locationToSave,msgPrefix) {
        var _this = this;
        //Ensure we have the latest JSON before saving it.
        locationToSave.updateJSON();

        voyent.locate.updateLocation({account:this.account,realm:this.realm,location:locationToSave.json}).then(function() {
            locationToSave.isPersisted = true;
            _this.push('_myLocations',locationToSave);
            _this.fire('message-info','Location ' + msgPrefix);
            _this._adjustBoundsAndPan();
        }).catch(function () {
            _this.fire('message-error','Location update failed');
        });
    },

    /**
     * Removes the currently loaded location.
     * @private
     */
    _removeLocation: function() {
        var _this = this;
        if (this._myLocations.length === 1) {
            this.fire('message-error','You must have at least one location');
            return;
        }
        //Close the info window and specify we don't want to save the location.
        this._closeInfoWindow(true);
        this._loadedLocation.removeFromMap();
        var query = {"location.properties.vras.id":this._loadedLocation.id};
        voyent.locate.deleteLocations({account:this.account,realm:this.realm,query:query}).then(function() {
            var indexToRemove = _this._myLocations.indexOf(_this._loadedLocation);
            if (indexToRemove > -1) {
                _this.splice('_myLocations',indexToRemove,1);
            }
            _this._loadedLocation = null;
            _this.fire('message-info','Location removed');
            _this._adjustBoundsAndPan();
        }).catch(function () {
            _this._loadedLocation.addToMap();
            _this.fire('message-error','Location removal failed');
        });
    },

    /**
     * Whenever a location is edited via the info window we will flag it so that it can be updated on close.
     * @private
     */
    _flagLocationForUpdating: function(e) {
        //This may fire when the toggle component is initializing.
        if (!this._loadedLocation) { return; }
        //Change event is fired from the input field where as checked-changed is fired from the toggle.
        if (e.type === 'change') {
            if (!this._validateLocationName(this._inputName)) { return; }
            this._loadedLocation.setName(this._inputName);
        }
        else {
            if (typeof this._inputPrivateResidence === 'undefined' ||
                this._inputPrivateResidence === this._loadedLocation.isPrivateResidence) {
                return;
            }
            this._loadedLocation.setPrivateResidence(this._inputPrivateResidence);
        }
        this._locationUpdatePending = true;
    },

    /**
     * Opens the dialog for creating a new address location.
     * @private
     */
    _addAddressBasedLocation: function() {
        var _this = this;
        //Always start with a fresh dialog.
        this._resetDialogProperties();
        //Open the dialog and initialize the autocomplete.
        this._openDialog(function () {
            setTimeout(function() {
                _this._createLocation(_this._locationName,_this._isPrivateResidence,
                    new google.maps.Marker({
                    position: _this._placeCoordinates,
                    map: _this._map,
                    draggable: true,
                    icon: _this._MY_LOCATION_ICON_INACTIVE
                }),'created');
                _this._resetDialogProperties();
            },0);
        });
        //Ensure we initialize the autoComplete.
        _this._setupAutoComplete();
    },

    /**
     * Handles saving a location after its info window properties have changed.
     * @private
     */
    _savePendingOrNewLocation: function() {
        if (this._loadedLocation && this._locationUpdatePending) {
            this._saveLocation(this._loadedLocation,this._loadedLocation.isPersisted ? 'updated' : 'created');
            this._locationUpdatePending = false;
        }
    },

    /**
     * Validates that the locations have a unique name property.
     * @param name
     * @returns {boolean}
     * @private
     */
    _validateLocationName: function(name) {
        if (!name || !name.trim()) {
            this.fire('message-error', 'Location must have a name');
            return false;
        }
        for (var i=0; i<this._myLocations.length; i++) {
            if (this._myLocations[i].name === name) {
                this.fire('message-error', 'Location names must be unique');
                return false;
            }
        }
        return true;
    },

    /**
     * Initializes the infoWindow object and sets up associated listeners.
     * @private
     */
    _setupInfoWindow: function() {
        var _this = this;
        //Initialize infoWindow object for later.
        _this._infoWindow = new google.maps.InfoWindow();
        //Close the infoWindow and re-display the previously hidden overlay when clicking on the map.
        google.maps.event.addListener(_this._map, 'click', function(e) {
            //In some cases we may want to ignore map clicks, ignore once and then reset it.
            if (_this._ignoreMapClick) {
                _this._ignoreMapClick = false;
                return;
            }
            _this._closeInfoWindow();
            if (_this._loadedLocation) {
                _this._loadedLocation.nameOverlay.displayAndDraw();
            }
            //If we have a placeId then it means a location of interest was clicked on the map. In this case we will
            //replace the default infoWindow with a custom one so the user can optionally add it to their locations.
            if (e.placeId) {
                //Prevent the default info window from opening.
                e.stop();
                _this._loadedLocation = null;
                _this._pinDropLocation = null;
                _this._placesService.getDetails({placeId: e.placeId}, function(place,status) {
                    if (status === 'OK') {
                        _this._selectedPlace = _this._buildPlaceDetails(place);
                    }
                    else {
                        _this._selectedPlace = {
                            "name":'Unknown Location',
                            "latLng":e.latLng
                        };
                    }
                    _this._toggleInfoWindow(null);
                });
            }
        });
        //When clicking the close button on the infoWindow redisplay the overlay.
        google.maps.event.addListener(_this._infoWindow,'closeclick',function() {
            _this._closeInfoWindow();
            if (_this._loadedLocation) {
                _this._loadedLocation.nameOverlay.displayAndDraw();
            }
            _this._selectedPlace = null;
        });
    },

    /**
     * Displays an infoWindow that is triggered when clicking on location markers or clicking on a place icon.
     * @param myLocation
     * @private
     */
    _toggleInfoWindow: function(myLocation) {
        var _this = this;
        //If the selected infoWindow is already opened then close it.
        if (this._infoWindowOpen && myLocation && myLocation === this._loadedLocation) {
            this._closeInfoWindow();
            this._loadedLocation.nameOverlay.displayAndDraw();
        }
        else {
            //If the infoWindow was toggled by selecting another location then _closeInfoWindow
            //will not be triggered so we need to update the location here, if applicable.
            if (this._infoWindowOpen) {
                this._savePendingOrNewLocation();
            }
            //Do this async so we don't get rendering flicker when opening the info window.
            setTimeout(function() {
                //Re-display any previously hidden location overlay.
                if (_this._loadedLocation) {
                    _this._loadedLocation.marker.setIcon(_this._MY_LOCATION_ICON_INACTIVE);
                    _this._loadedLocation.nameOverlay.displayAndDraw();
                }
                //If we were passed a location then select it otherwise if we
                //have a selected place then render the custom info window.
                if (myLocation) {
                    _this._loadedLocation = myLocation;
                    _this._ignoreInputNameChanged = true;
                    _this._inputName = _this._loadedLocation.name;
                    _this._inputPrivateResidence = _this._loadedLocation.isPrivateResidence;
                    _this._infoWindow.open(_this._map,_this._loadedLocation.marker);
                    //Hide the current location's overlay.
                    _this._loadedLocation.nameOverlay.hide();
                    myLocation.marker.setIcon(_this._MY_LOCATION_ICON_ACTIVE);
                    //Focus on the name input.
                    setTimeout(function() {
                        _this.querySelector('#name').focus();
                    },0);
                }
                else if (_this._selectedPlace) {
                    _this._infoWindow.setPosition(_this._selectedPlace.latLng);
                    _this._infoWindow.open(_this._map);
                    //Focus on the name input.
                    setTimeout(function() {
                        _this.querySelector('#placeName').focus();
                    },0);
                }
                else if (_this._pinDropLocation) {
                    _this._infoWindow.setPosition(_this._pinDropLocation.latLng);
                    _this._infoWindow.open(_this._map);
                    //Focus on the name input.
                    setTimeout(function() {
                        _this.querySelector('#pinDropName').focus();
                    },0);
                }
                else { return; }
                _this.$.infoWindow.removeAttribute('hidden');
                _this._infoWindow.setContent(_this.$.infoWindow);
                _this._infoWindowOpen = true;
            },0);
        }
    },

    /**
     * Closes the info window.
     * @param skipSave
     * @private
     */
    _closeInfoWindow: function(skipSave) {
        this._infoWindow.close();
        this._infoWindowOpen = false;
        if (this._loadedLocation && !skipSave) {
            this._loadedLocation.marker.setIcon(this._MY_LOCATION_ICON_INACTIVE);
            this._savePendingOrNewLocation();
        }
    },

    /**
     * Handles closing the infoWindow on location name input key presses.
     * @param e
     * @private
     */
    _handleInfoWindowKeyPress: function(e) {
        //Close the infoWindow on Enter or Esc key presses
        if (e.keyCode === 13 || e.keyCode === 27) {
            this._toggleInfoWindow(this._loadedLocation);
        }
    },

    /**
     * Builds the relevant place details from the Google Places search result.
     * @param place
     * @private
     */
    _buildPlaceDetails: function(place) {
        var selectedPlace = {
            "name":place.name,
            "latLng":place.geometry.location
        };
        var addressComponent;
        for (var i=0; i<place.address_components.length; i++) {
            addressComponent = place.address_components[i];
            if (addressComponent.types.indexOf('street_number') > -1) {
                selectedPlace.streetNumber = addressComponent.short_name || addressComponent.long_name;
            }
            else if (addressComponent.types.indexOf('route') > -1) {
                selectedPlace.route = addressComponent.short_name || addressComponent.long_name;
            }
            else if (addressComponent.types.indexOf('locality') > -1) {
                selectedPlace.locality = addressComponent.short_name || addressComponent.long_name;
            }
            else if (addressComponent.types.indexOf('political') > -1 &&
                addressComponent.types.indexOf('country') === -1) {
                selectedPlace.political = addressComponent.short_name || addressComponent.long_name;
            }
            else if (addressComponent.types.indexOf('postal_code') > -1) {
                selectedPlace.postalCode = addressComponent.short_name || addressComponent.long_name;
            }
        }
        return selectedPlace;
    },

    /**
     * Adds the map control that contains the save and cancel buttons.
     * @private
     */
    _addCustomControls: function() {
        if (this._customControlsAdded) { return; }
        var _this = this;
        this.$.customControls.removeAttribute('hidden');
        this._map.controls[google.maps.ControlPosition.RIGHT_TOP].push(this.$.customControls);
        this._customControlsAdded = true;
        //Setup our tooltips after we've added our custom control. Add a slight delay to allow the map to position the control first.
        setTimeout(function() {
            _this._setupTooltips([{
                    tooltipSelector:'#addLocationTooltip',
                    targetSelector:'#customControls paper-button',
                    position:"below",
                    topPadding:(_this.isMobile ? _this._tooltipPadding : 0) - 25
                },
                {
                    tooltipSelector:'#mapTooltip',
                    targetSelector:'#map',
                    position:!_this.isMobile ? _this._mapTooltipDesktopPos : (_this.isPortrait ? _this._mapTooltipPortraitPos : _this._mapTooltipLandscapePos),
                    topPadding:!_this.isMobile ? -_this._tooltipPadding : (_this.isPortrait ? _this._tooltipPadding : 0)
                }
            ]);
            //Close the tooltips when the user begins to interact with the page.
            window.addEventListener('click',function(e) {
                e.stopPropagation();
                _this._hideTooltips();
                _this._tooltipsDisplayed = false;
            },{once:true});
        },500);
    },

    /**
     * Toggles tooltip help bubbles.
     * @private
     */
    _toggleTooltipHelp: function() {
        this._toggleTooltips();
        this._repositionTooltips();
        this._tooltipsDisplayed = !this._tooltipsDisplayed;
    },

    /**
     * Monitors the `isPortrait` property and adjusts tooltip position as necessary.
     * @private
     */
    _isPortraitChanged: function(isPortrait) {
        if (!this.isMobile || !this._tooltipsList) { return; }
        var _this = this;
        //Adjust tooltip position on orientation changes. Add a slight delay to allow the device to switch orientations.
        setTimeout(function() {
            _this._tooltipsList[1].position = isPortrait ? _this._mapTooltipPortraitPos : _this._mapTooltipLandscapePos;
            _this._tooltipsList[1].topPadding = isPortrait ? _this._tooltipPadding : 0;
            _this._repositionTooltips();
        },400);
    },

    //The dialog functions below override the functions in the behaviour.

    /**
     * Opens the dialog for creating a new location.
     * @param confirmFunc
     * @param cancelFunc
     * @private
     */
    _openDialog: function(confirmFunc,cancelFunc) {
        this._dialogConfirmFunc = confirmFunc;
        this._dialogCancelFunc = cancelFunc;
        var dialog = this.querySelector('#modalDialog');
        if (dialog) { dialog.open(); }
    },

    /**
     * Handles dialog input validation and calling the confirmation function if available.
     * @private
     */
    _confirmDialog: function() {
        if (!this._validateDialog()) { return; }
        //We allow for passing the confirm function directly or as a string.
        if (this._dialogConfirmFunc) {
            if (typeof this._dialogConfirmFunc === 'string') { this[this._dialogConfirmFunc](); }
            else { this._dialogConfirmFunc(); }
        }
        //Close the dialog after.
        this._closeDialog(true);
    },

    /**
     * Handles closing the dialog and calling the cancel function if available.
     * @param confirmed
     * @private
     */
    _closeDialog: function(confirmed) {
        //Only call the cancel function if this is triggered by a cancel.
        //We allow passing the confirm function directly or as a string.
        if (!confirmed && this._dialogCancelFunc) {
            if (typeof this._dialogCancelFunc === 'string') { this[this._dialogCancelFunc](); }
            else { this._dialogCancelFunc(); }
        }
        this._dialogConfirmFunc = this._dialogCancelFunc = null;
        this.querySelector('#modalDialog').close();
    },

    /**
     * Validates each field in the dialog.
     * @returns {boolean}
     * @private
     */
    _validateDialog: function() {
        var haveErrors = false;
        if (!this.querySelector('#autoComplete').validate()) {
            haveErrors = true;
        }
        if (!this.querySelector('#locationName').validate()) {
            haveErrors = true;
        }
        return !haveErrors;
    },

    /**
     * Initialize the listeners required to pin drop a location by holding the mouse down on the map.
     * @private
     */
    _setupDrawingListeners: function () {
        var _this = this;
        google.maps.event.addListener(this._map, 'mousedown', function(e) {
            //Ensure we only setup one interval. Mousedown will fire twice on mobile for pinch events.
            if (_this._mouseHoldTimer) { return; }
            //If the user holds the mouse down for one second then create a new location at that position.
            _this._mouseHoldTimer = setTimeout(function() {
                //We require this flag so the infoWindow will not be closed immediately after releasing the mouse.
                _this._ignoreMapClick = true;
                //In order for the map to exit panning mode in desktop after the mouse hold operation we need the map to catch
                //the mouseup event and not the newly rendered infoWindow. To do this we will render the infoWindow slightly
                //above the position that the user clicked so that when they release the mouse it is received by the map.
                var point = _this._map.getProjection().fromLatLngToPoint(e.latLng);
                var latLng = _this._map.getProjection().fromPointToLatLng(
                    new google.maps.Point(point.x,point.y-_this._getNewPinDropYPositionBasedonZoom())
                );
                //Reset some values and create a container for our pin drop location data.
                _this._loadedLocation = null;
                _this._selectedPlace = null;
                _this._pinDropLocation = {
                        "name":'',
                        "isPrivateResidence":false,
                        "latLng":latLng
                };
                //Open the infoWindow.
                _this._toggleInfoWindow(null);
                //Set the latLng position of the new location to where the user actually clicked rather than
                //slightly above due to the above noted requirement. We will apply this position to the
                //infoWindow position on mouseup and the location will be created at this location.
                setTimeout(function() {
                    _this._pinDropLocation.latLng = e.latLng;
                },0);
            },1000);
        });
        google.maps.event.addListener(this._map, 'mouseup', function() {
            //Adjust the infoWindow position to where the user actually clicked.
            if (_this._pinDropLocation) {
                _this._infoWindow.setPosition(_this._pinDropLocation.latLng);
            }
            clearTimeout(_this._mouseHoldTimer);
            _this._mouseHoldTimer = null;
        });
        google.maps.event.addListener(this._map, 'drag', function() {
            clearTimeout(_this._mouseHoldTimer);
            _this._mouseHoldTimer = null;
        });
    },

    /**
     * We initially render the pin drop infoWindow slightly above the position of where they clicked
     * but the amount of adjustment required varies at each zoom level. This function will return
     * the y coordinate amount that the infoWindow should be moved up for each zoom level.
     * @returns {number}
     * @private
     */
    _getNewPinDropYPositionBasedonZoom: function() {
        //We know that at zoom level 0 we require 8 y coordinates to space the infoWindow far enough above the
        //mouse to ensure the map receives the mouseout event. We also know that each zoom level is 50% more
        //scaled than the last so we will divide by 2 x number of times where x is the current zoom level.
        var pixelAdjustementAtZoomLevelZero = 8;
        return pixelAdjustementAtZoomLevelZero/(Math.pow(2,this._map.getZoom()));
    },

    /**
     * Adds a new location that was created via pin drop.
     * @private
     */
    _addPinDropToMyLocations: function() {
        if (!this._pinDropLocation) { return; }
        if (!this._validateLocationName(this._pinDropLocation.name)) { return; }
        this._loadedLocation = this._createLocation(this._pinDropLocation.name,this._pinDropLocation.isPrivateResidence,
            new google.maps.Marker({
                map: this._map,
                position: this._pinDropLocation.latLng,
                draggable: true,
                icon: this._MY_LOCATION_ICON_INACTIVE
        }),'created');
        this._pinDropLocation = null;
        this._closeInfoWindow();
    },

    /**
     * Adds the last selected Google Place to the map as a new location.
     * @private
     */
    _addPlaceToMyLocations: function() {
        if (!this._selectedPlace) { return; }
        if (!this._validateLocationName(this._selectedPlace.name)) { return; }
        this._loadedLocation = this._createLocation(this._selectedPlace.name,false,
            new google.maps.Marker({
                map: this._map,
                position: this._selectedPlace.latLng,
                draggable: true,
                icon: this._MY_LOCATION_ICON_INACTIVE
        }),'created');
        this._selectedPlace = null;
        this._closeInfoWindow();
    },

    /**
     * Builds a location record from the passed marker and returns it.
     * @param name
     * @param isPrivateResidence
     * @param marker
     * @param msgPrefix
     * @param skipSave
     * @returns {Voyent.AlertBehaviour._MyLocation}
     * @private
     */
    _createLocation: function(name,isPrivateResidence,marker,msgPrefix,skipSave) {
        var newLocation = new this._MyLocation(null, name, isPrivateResidence ,marker);
        if (!skipSave) {
            this._saveLocation(newLocation,msgPrefix);
        }
        return newLocation;
    },

    /**
     * Resets input fields used in the dialog.
     * @private
     */
    _resetDialogProperties: function() {
        this._autocompleteValue = null;
        this._locationName = null;
        this._isPrivateResidence = false;
        if (this.querySelector('#autoComplete')) {
            this.querySelector('#locationName').invalid = false;
        }
        if (this.querySelector('#locationName')) {
            this.querySelector('#locationName').invalid = false;
        }
    },

    /**
     * Initialize the places autoComplete.
     * @private
     */
    _setupAutoComplete: function() {
        if (this._autoComplete) { return; }
        var _this = this, place;
        var autocompleteInput = this.$$('#autoComplete').querySelector('input');
        //Wait until we have the area region so we can favour results from within that region.
        function waitForAreaRegion() {
            if (!_this._areaRegion) {
                setTimeout(waitForAreaRegion,50);
                return;
            }
            _this._autoComplete = new google.maps.places.Autocomplete(autocompleteInput, {
                "bounds":_this._areaRegion.bounds, "strictBounds":false
            });
            google.maps.event.addListener(_this._autoComplete, 'place_changed', function() {
                place = _this._autoComplete.getPlace();
                if (place && place.geometry && place.geometry.location) {
                    _this._placeCoordinates = place.geometry.location;
                }
                else if (!place || Object.keys(place).length === 1) {
                    _this._placeCoordinates = null;
                }
                _this.querySelector('#autoComplete').validate();
            });
        }
        waitForAreaRegion();
    },

    /**
     * Listens for changes to the autocomplete input so we can clear the
     * place selection if the user manually clears the autocomplete.
     * @private
     */
    _autoCompleteChanged: function() {
        if (!this._autocompleteValue) {
            this._placeCoordinates = null;
        }
    },

    /**
     * Handles trapping specific keypresses on the autocomplete when the list is open so they don't bubble to the dialog.
     * @param e
     * @private
     */
    _handleAutocompleteKeyPress: function(e) {
        //Reset our keypress state on every 2 keypresses because we only need to track the last two
        //keypreses - one for selecting a list entry and one for the enter or escape keys after.
        if (this._autocompleteKeyupCount === 2) {
            this._autocompleteKeyupCount = 0;
            this._autocompleteListItemSelected = false;
        }
        if (document.querySelector('.pac-item-selected')) {
            this._autocompleteEntryWasSelected = true;
        }
        //When an autocomplete list entry was selected on the last keypress then
        //we want to prevent the event from bubbling on any enter or escape key
        //presses after so we don't submit the dialog listener.
        if (this._autocompleteEntryWasSelected && (e.keyCode === 13 || e.keyCode === 27)) {
            this._autocompleteEntryWasSelected = false;
            e.stopPropagation();
        }
        this._autocompleteKeyupCount++;
    },

    /**
     * Updates the map bounds so all the locations are in view and then pans the map.
     * @private
     */
    _adjustBoundsAndPan: function() {
        //Temporary set the maxZoom so the map doesn't zoom in too far when panning.
        this._map.setOptions({maxZoom:16});
        var bounds = new google.maps.LatLngBounds();
        if (this._myLocations.length) {
            for (var i=0; i<this._myLocations.length; i++) {
                bounds.extend(this._myLocations[i].marker.getPosition());
            }
            this._map.fitBounds(bounds);
            this._map.panToBounds(bounds);
        }
        else {
            this._skipRegionPanning = false;
            this._zoomOnRegion();
        }
        this._map.setOptions({maxZoom:null});
    },

    /**
     * Validates the places search autocomplete inside the dialog.
     * @returns {boolean}
     * @private
     */
    _validatePlacesSearch: function() {
        var elem = this.querySelector('#autoComplete');
        if (!this._autocompleteValue ||!this._autocompleteValue.trim()) {
            elem.setAttribute('error-message','Please search for a location');
            return false;
        }
        if (!this._placeCoordinates) {
            elem.setAttribute('error-message','Must select an item from the search results');
            return false;
        }
        return true;
    },

    /**
     * Validates the places search autocomplete inside the dialog on blur.
     * @private
     */
    _validatePlacesSearchOnBlur: function() {
        var _this = this;
        setTimeout(function() {
            if (document.activeElement.getAttribute('is') === 'iron-input') {
                var parentInput = document.activeElement.parentNode;
                while (parentInput.nodeName !== 'PAPER-INPUT') {
                    parentInput = parentInput.parentNode;
                }
                if (parentInput.id === 'autoComplete') { return; }
            }
            _this.querySelector('#autoComplete').validate();
        },0);
    },

    /**
     * Validates the location name field inside the dialog.
     * @returns {boolean}
     * @private
     */
    _validateDialogLocationName: function() {
        var elem = this.querySelector('#locationName');
        if (!this._locationName || !this._locationName.trim()) {
            elem.setAttribute('error-message','Location must have a name');
            return false;
        }
        for (var i=0; i<this._myLocations.length; i++) {
            if (this._myLocations[i].name === this._locationName) {
                elem.setAttribute('error-message','Name must be unique');
                return false;
            }
        }
        return true;
    },

    /**
     * Validates the location name field inside the dialog on blur.
     * @private
     */
    _validateDialogLocationNameOnBlur: function() {
        var _this = this;
        setTimeout(function() {
            if (document.activeElement.getAttribute('is') === 'iron-input') {
                var parentInput = document.activeElement.parentNode;
                while (parentInput.nodeName !== 'PAPER-INPUT') {
                    parentInput = parentInput.parentNode;
                }
                if (parentInput.id === 'locationName') { return; }
            }
            _this.querySelector('#locationName').validate();
        },0);
    },

    /**
     * Listens for changes on the list of locations.
     * @param length
     * @private
     */
    _myLocationsUpdated: function(length) {
        //Always skip panning to the region when we have at least one location.
        this._skipRegionPanning = !!length;
    },

    /**
     * Monitors changes to the location input name and flags the location for updating.
     * We will ignore this event when the location name is changed programatically.
     * @private
     */
    _inputNameChanged: function() {
        //We use this rather than an on-change on the component because this does not fire on infoWindow blur on iOS.
        if (this._ignoreInputNameChanged) {
            this._ignoreInputNameChanged = false;
            return;
        }
        this._flagLocationForUpdating({"type":"change"});
    }
});