Polymer({
    is: "voyent-alert-properties",
    behaviors: [Voyent.AlertBehaviour],

    properties: {
        /**
         * Contains references to all necessary data associated with maintaining an Alert Template on the map.
         */
        _alertTemplateData: { type: Object, value: null, notify: true }
    },

    observers: [
        '_featuresChanged(_alertTemplateData.alertTemplate.zones.features.length)'
    ],

    ready: function() {
        this._selected = this._editing = this._addingNew = false;
        this._readOnlyProperties = ['Editable','Color','Opacity'];
    },

    /**
     * Toggles renaming mode for an Alert Template.
     * @private
     */
    _toggleAlertTemplateRenaming: function() {
        var _this = this;
        var renaming = !this.get('_alertTemplateData.alertTemplate.tmpProperties.renaming');
        if (renaming) {
            //Set the input value to the current zoneId.
            this.set('_alertTemplateData.alertTemplate.tmpProperties.newName',this.get('_alertTemplateData.alertTemplate.label'));
            //Focus on the input.
            setTimeout(function() {
                _this.querySelector('#alertTemplate').focus();
            },0);
        }
        //Toggle renaming mode.
        this.set('_alertTemplateData.alertTemplate.tmpProperties.renaming',renaming);
    },

    /**
     * Confirms or cancels the renaming of an Alert Template via enter and esc keys.
     * @param e
     * @private
     */
    _renameAlertTemplateViaKeydown: function(e) {
        //Prevent the event from bubbling up the DOM tree
        e.stopPropagation();
        if (e.which === 13) { //Enter
            this._renameAlertTemplate();
        }
        else if (e.which === 27) { //Esc
            this._toggleAlertTemplateRenaming();
        }
    },

    /**
     * Confirms the renaming of an Alert Template.
     * @private
     */
    _renameAlertTemplate: function() {
        //Set the new label and reset the editing mode input state.
        this.set('_alertTemplateData.alertTemplate.label',this.get('_alertTemplateData.alertTemplate.tmpProperties.newName'));
        this.set('_alertTemplateData.alertTemplate.tmpProperties.newName','');
        //Toggle renaming mode.
        this._toggleAlertTemplateRenaming();
    },

    /**
     * Toggles renaming mode for Proximity Zones.
     * @param eOrI
     * @private
     */
    _toggleProximityZoneRenaming: function(eOrI) {
        var _this = this;
        //This function will either be passed an event (from the ui) or a direct index (from the JS).
        var i = eOrI.model ? eOrI.model.get('index') : eOrI;
        var renaming = !this.get('_alertTemplateData.alertTemplate.zones.features.'+i+'.tmpProperties.renaming');
        if (renaming) {
            //Set the input value to the current zoneId.
            this.set('_alertTemplateData.alertTemplate.zones.features.'+i+'.tmpProperties.newName',
                this._alertTemplateData.alertTemplate.zones.features[i].properties.zoneId);
            //Focus on the input.
            setTimeout(function() {
                _this.querySelector('#zone-'+i).focus();
            },0);
        }
        else {
            //Always reset the input value so it updates each time editing mode is entered
            this.set('_alertTemplateData.alertTemplate.zones.features.'+i+'.tmpProperties.newName','');
        }
        //Toggle renaming mode.
        this.set('_alertTemplateData.alertTemplate.zones.features.'+i+'.tmpProperties.renaming',renaming);
    },

    /**
     * Confirms or cancels the renaming of a Proximity Zone via enter and esc keys.
     * @param e
     * @private
     */
    _renameProximityZoneViaKeydown: function(e) {
        //Prevent the event from bubbling up the DOM tree.
        if (e.which === 13) { //Enter
            this._renameProximityZone(e);
        }
        else if (e.which === 27) { //Esc
            this._toggleProximityZoneRenaming(e);
        }
    },

    /**
     * Confirms the renaming of a Proximity Zone.
     * @param e
     * @private
     */
    _renameProximityZone: function(e) {
        var i = e.model.get('index');
        //Set the new zoneId and reset the editing mode input state.
        this.set('_alertTemplateData.alertTemplate.zones.features.'+i+'.properties.zoneId',
            this.get('_alertTemplateData.alertTemplate.zones.features.'+i+'.tmpProperties.newName'));
        this.set('_alertTemplateData.alertTemplate.zones.features.'+i+'.tmpProperties.newName','');
        //Toggle renaming mode.
        this._toggleProximityZoneRenaming(i);
        //Redraw the overlay since the content changed.
        this._redrawZoneOverlay(i);
    },

    /**
     * Adds a new proximity zone to the Alert Template. The new zone is 50% larger than the largest existing zone.
     * @private
     */
    _addProximityZone: function() {
        var smallestIndex = 50, //50 because the highest index ever is 49
            largestRadius = 0; //0 because every zone will be bigger
        //Get the size of largest circle and our smallest zIndex so we can determine what values to set for the new one
        for (var i=0; i<this._alertTemplateData.circles.length; i++) {
            if (this._alertTemplateData.alertTemplate.zones.features[i].properties.googleMaps.radius >= largestRadius) {
                largestRadius = this._alertTemplateData.alertTemplate.zones.features[i].properties.googleMaps.radius;
            }
            if (this._alertTemplateData.alertTemplate.zones.features[i].properties.googleMaps.zIndex <= smallestIndex){
                smallestIndex = this._alertTemplateData.alertTemplate.zones.features[i].properties.googleMaps.zIndex;
            }
        }
        //Set the new zone radius as 50% larger than the current largest zone.
        largestRadius = largestRadius + largestRadius * 0.5;
        //Set the new zone zIndex slightly lower so it sits behind the other zones.
        smallestIndex = smallestIndex - 1;

        //Build the properties for the new circle.
        var props = this._getCircleProperties();
        props.radius = largestRadius;
        props.zIndex = smallestIndex;
        //Create the google maps circle and bind it to the marker.
        var newCircle = new google.maps.Circle(props);
        newCircle.bindTo('center', this._alertTemplateData.marker, 'position');

        //Build the geoJSON structure for the proximity zone.
        var newCircleJSON = this._getZoneJSON();
        newCircleJSON.properties.zoneId = 'Zone_' + (this._alertTemplateData.alertTemplate.zones.features.length + 1);
        //Update our lists.
        this.push('_alertTemplateData.alertTemplate.zones.features',newCircleJSON);
        this.push('_alertTemplateData.circles',newCircle);
        //Add the change listeners to the new circle.
        this._setupChangeListeners();
        //Update the JSON to include the new circle.
        this._updateAlertTemplateJSON();
        //Draw the Proximity Zone label overlay and save a reference to it.
        this.push('_alertTemplateData.zoneOverlays',new this._ProximityZoneOverlay(this._alertTemplateData.alertTemplate.zones.features.length-1));
    },

    /**
     * Removes a Proximity Zone from the Alert Template.
     * @private
     */
    _removeProximityZone: function(e) {
        //Get the index of the proximity zone that is to be removed.
        var i = e.model.get('index');
        //Remove the zone from the alertTemplate JSON.
        this.splice('_alertTemplateData.alertTemplate.zones.features',i,1);
        //Remove the circle from the map and the reference to it.
        this._alertTemplateData.circles[i].setMap(null);
        this.splice('_alertTemplateData.circles',i,1);
        //Remove the overlay.
        this._alertTemplateData.zoneOverlays[i].setMap(null);
        this.splice('_alertTemplateData.zoneOverlays',i,1);
    },

    /**
     * Toggles new property mode for a Proximity Zone.
     * @param e
     * @private
     */
    _toggleAddingNewProperty: function(e) {
        var _this = this;
        this._addingNew = !this._addingNew;
        if (this._addingNew) {
            //Focus on the input.
            setTimeout(function() {
                _this.querySelector('#new-'+e.model.get('index')).focus();
            },0);
        }
        else {
            //Reset the input values so they update each time editing mode is entered.
            this._customPropKey = this._customPropVal = null;
        }
    },

    /**
     * Confirms or cancels the saving of a new custom property via enter and esc keys.
     * @param e
     * @private
     */
    _saveNewPropertyViaKeydown: function(e) {
        e.stopPropagation();
        if (e.which === 13) { //Enter
            this._saveNewProperty(e);
        }
        else if (e.which === 27) { //Esc
            this._toggleAddingNewProperty(e);
        }
    },

    /**
     * Saves a new custom property.
     * @param e
     * @private
     */
    _saveNewProperty: function(e) {
        //Make sure we have values for and that the key is not one of the standard keys.
        if (this._customPropKey && this._customPropVal &&
            this._readOnlyProperties.indexOf(this._customPropKey) === -1) {
            var index = e.model.get('index');
            //Clone properties and re-set it so the computed binding _toArray updates.
            var properties = JSON.parse(JSON.stringify(this._alertTemplateData.alertTemplate.zones.features[index].properties));
            properties[this._customPropKey] = this._customPropVal;
            this.set('_alertTemplateData.alertTemplate.zones.features.'+index+'.properties',properties);
            //Reset the new property input values.
            this._customPropKey = this._customPropVal = null;
            //Toggle new property mode.
            this._toggleAddingNewProperty();
        }
    },

    /**
     * Toggles Proximity Zone property editing mode.
     * @param e
     * @private
     */
    _togglePropertyEditing: function(e) {
        var _this = this;
        this._editing = !this._editing;
        var index = e.model.get('index');
        if (this._editing) { //We are entering edit mode.
            var properties = this._alertTemplateData.alertTemplate.zones.features[index].properties;
            switch (this._selected) {
                //Copy the current state of each of the properties into our editing mode inputs.
                case 'Editable':
                    //Convert boolean to string for UI.
                    this.set('_editableVal',properties['Editable'] ? 'true' : 'false');
                    //Focus on the input.
                    setTimeout(function() {
                        _this.querySelector('#editable-'+index).focus();
                    },0);
                    break;
                case 'Color':
                    this.set('_colorVal',properties['Color']);
                    //Also call the jscolor API so we are sure the input style updates properly.
                function waitForJSColor() {
                    var colorPicker = _this.querySelector('#jsColor-'+index);
                    //Wait till we have a reference to the colour picker.
                    if (!colorPicker || !colorPicker.jscolor) {
                        setTimeout(function(){waitForJSColor();},10);
                        return;
                    }
                    colorPicker.jscolor.fromString(_this.get('_colorVal'));
                    //Focus on the input and display the color picker.
                    setTimeout(function() {
                        colorPicker.focus();
                        colorPicker.jscolor.show();
                    },0);
                }
                    waitForJSColor();
                    break;
                case 'Opacity':
                    this.set('_opacityVal',properties['Opacity']);
                    //Focus on the input.
                    setTimeout(function() {
                        var opacitySlider = _this.querySelector('#opacity-'+index);
                        opacitySlider.focus();
                    },0);
                    break;
                default:
                    this._customPropKey = this._selected;
                    this._customPropVal = properties[this._customPropKey];
                    //Focus on the input.
                    setTimeout(function() {
                        var customInput = _this.querySelector('#custom-'+index);
                        customInput.focus();
                    },0);
            }

            //Setup the jscolor picker.
            setTimeout(function() {
                jscolor.installByClassName("jscolor");
            },0);
        }
        else { //We are exiting editing mode.
            //Clear the editing mode inputs.
            this._editableVal = this._colorVal = this._opacityVal = this._customPropKey = this._customPropVal = null;
            switch (this._selected) {
                case 'Color':
                    //Force the jscolor picker to be hidden in case the color was confirmed via keydown
                    var colorPicker = this.querySelector('#jsColor-'+index);
                    if (colorPicker) {
                        colorPicker.jscolor.hide();
                    }
                    //Redraw the overlay since the colour changed.
                    this._redrawZoneOverlay(index);
            }
        }
    },

    /**
     * Confirms or cancels the edit of a Proximity Zone property via enter and esc keys.
     * @param e
     * @private
     */
    _editPropertyViaKeydown: function(e) {
        //Prevent the event from bubbling up the DOM tree
        e.stopPropagation();
        if (e.which === 13) { //Enter
            this._editProperty(e);
        }
        else if (e.which === 27) { //Esc
            this._togglePropertyEditing(e);
        }
    },

    /**
     * Confirms the edit of a Proximity Zone property.
     * @param e
     * @private
     */
    _editProperty: function(e) {
        var _this = this;
        var index = e.model.get('index');
        //Clone properties and re-set it so the computed binding _toArray updates.
        var properties = JSON.parse(JSON.stringify(this._alertTemplateData.alertTemplate.zones.features[index].properties));
        switch (this._selected) {
            //Copy the new property value from our editing mode inputs to the JSON. We don't bind directly in case we need to revert.
            case 'Editable':
                properties['Editable'] = this._editableVal.toLowerCase() === 'true'; //Convert string from UI to boolean
                //Set the Editable state on the circle.
                this._alertTemplateData.circles[index].setEditable(properties.Editable);
                this.set('_editableVal',null);
                break;
            case 'Color':
                properties['Color'] = this._colorVal;
                //Set the Color on the circle.
                this._alertTemplateData.circles[index].setOptions({"fillColor":'#'+properties.Color});
                this.set('_colorVal',null);
                break;
            case 'Opacity':
                properties['Opacity'] = this._opacityVal;
                //Set the Opacity on the circle.
                this._alertTemplateData.circles[index].setOptions({"fillOpacity":properties.Opacity});
                this.set('_opacityVal',null);
                break;
            default:
                //Block the user from creating a property with one of the standard keys.
                if (this._readOnlyProperties.indexOf(this._customPropKey) !== -1) {
                    return;
                }
                properties[this._customPropKey] = this._customPropVal;
                //If the selected property key changed delete the old one and update the table selection.
                if (this._selected !== this._customPropKey) {
                    delete properties[this._selected];
                    setTimeout(function() {
                        _this._selected = _this._customPropKey;
                        //Reset the editing mode inputs.
                        _this._customPropKey = _this._customPropVal = null;
                    },0);
                }
        }
        this.set('_alertTemplateData.alertTemplate.zones.features.'+index+'.properties',properties);
        //Toggle editing mode.
        this._togglePropertyEditing(e);
    },

    /**
     * Removes the currently selected property.
     * @param e
     * @private
     */
    _removeSelectedProperty: function(e) {
        var index = e.model.get('index');
        //Clone properties and re-set it so the computed binding _toArray updates.
        var properties = JSON.parse(JSON.stringify(this._alertTemplateData.alertTemplate.zones.features[index].properties));
        delete properties[this._selected];
        this.set('_alertTemplateData.alertTemplate.zones.features.'+index+'.properties',properties);
        //Toggle property editing since this function is only available during editing mode.
        this._togglePropertyEditing(e);
    },

    /**
     * Set the Proximity Zone properties list to be sorted by property keys.
     * @param e
     * @private
     */
    _sortByProperty: function(e) {
        this._sortType = 'key';
        this._sortDirectionAsc = !this._sortDirectionAsc;
        this.querySelector('#propertyRepeat-'+e.model.get('index')).render(); // force a re-sort
        this._maintainSelectionAfterSort();
    },

    /**
     * Set the Proximity Zone properties list to be sorted by property values.
     * @param e
     * @private
     */
    _sortByValue: function(e) {
        this._sortType = 'value';
        this._sortDirectionAsc = !this._sortDirectionAsc;
        this.querySelector('#propertyRepeat-'+e.model.get('index')).render(); // force a re-sort
        this._maintainSelectionAfterSort();
    },

    /**
     * Monitors the number of zones that we the Alert Template has.
     * @param length
     * @private
     */
    _featuresChanged: function(length) {
        this.set('_hasOneZone',length === 1);
    },

    /**
     * Triggered each time a property row is selected or de-selected. Toggles the editing mode for that property.
     * @param e
     * @param detail
     * @private
     */
    _onIronActivate: function(e,detail) {
        var _this = this;
        //Do this async since iron-activate fires before this._selected changes.
        setTimeout(function() {
            _this._togglePropertyEditing(e);
        },0);
    },

    /**
     * Template helper for converting Proximity Zone properties object into an array so we can iterate them.
     * @param obj
     * @returns {Array}
     * @private
     */
    _toArray: function(obj) {
        var array = [];
        for (var key in obj) {
            if (!obj.hasOwnProperty(key)) {
                continue;
            }
            if (key !== 'googleMaps' &&
                key !== 'zoneId' &&
                key !== 'messageTemplate') {
                array.push({"key":key,"value":obj[key]});
            }
        }
        return array;
    },

    /**
     * Template helper that determines if the currently selected property matches the passed key.
     * @param key
     * @param selected
     * @returns {boolean}
     * @private
     */
    _selectedEquals: function(key,selected) {
        if (key !== 'Other') {
            return key === selected;
        }
        else {
            return this._readOnlyProperties.indexOf(selected) === -1;
        }
    },

    /**
     * Template helper for sorting the Proximity Zone properties table.
     * @param a
     * @param b
     * @returns {number}
     * @private
     */
    _sortProperties: function(a, b) {
        if (!this._sortType) {
            this._sortType = 'key';
        }
        if (this._sortDirectionAsc) {
            return a[this._sortType].toString().localeCompare(b[this._sortType]);
        }
        else {
            return b[this._sortType].toString().localeCompare(a[this._sortType]);
        }
    },

    /**
     * If a row is selected when sorting and that row changes positions then the selected
     * row will still be the row's previous position so we'll re-set the selection.
     * @private
     */
    _maintainSelectionAfterSort: function() {
        var _this = this;
        var selected = this._selected;
        this._selected = null;
        setTimeout(function() {
            _this._selected = selected;
        },0);
    }
});