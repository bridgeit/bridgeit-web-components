Polymer({
    is: 'voyent-mobile-alert-editor',
    behaviors: [Voyent.AlertMapBehaviour,Voyent.AlertBehaviour],

    properties: {
        /**
         * Indicates whether an alert is currently being fetched from database and loaded into the editor.
         */
        isAlertLoading: { type: Boolean, value: false, readOnly: true, notify: true, observer: '_isAlertLoading' },
        /**
         * Indicates whether an alert is currently loaded in the editor.
         */
        isAlertLoaded: { type: Boolean, value: false, readOnly: true, notify: true }
    },

    observers: [
        '_loadedAlertChanged(_loadedAlert)'
    ],

    /**
     * Load the passed template at the specified coordinates.
     * @param template - The template JSON to be loaded.
     * @param coordinates - The coordinates in object form {lat:{{lat}},lng:{{lng}}}. If not provided the alert will be centered on the region.
     */
    loadAlert: function(template,coordinates) {
        var _this = this;
        // Clone the template since we will modify the record
        template = JSON.parse(JSON.stringify(template));
        this._setIsAlertLoading(true);
        if (!coordinates) {
            if (!this._areaRegion) {
                this._areaRegionIsAvailable().then(function() {
                    _this.loadAlert(template,null);
                });
                return;
            }
            else {
                if (template.properties.center) {
                    coordinates = template.properties.center;
                    delete template.properties.center;
                }
                else {
                    var center = _this._areaRegion.bounds.getCenter();
                    coordinates = {"lat":center.lat(),"lng":center.lng()};
                }
            }
        }
        // Clear the map of any loaded alert template before drawing
        if (this._loadedAlert) {
            this.clearMap();
        }
        // Remove the parent's id from the record as we'll generate a new one
        var id = template._id;
        delete template._id;
        // If we have a geometry then use either the passed coordinates, the fixed
        // template location or the center of the region (determined above)
        var latLng = null;
        if (template.geo) {
            latLng = new google.maps.LatLng(coordinates);
        }
        template.state = 'draft'; //Default to draft
        this._drawAndLoadAlertTemplate(template,latLng);
        this._loadedAlert.template.setParentId(id);
        this._setIsAlertLoading(false);
    },

    //******************PRIVATE API******************

    _onAfterLogin: function() {
        this._fetchRealmRegion();
    },

    /**
     * Listens to whether an alert is loading and toggles the flag for skipping region panning.
     * @param isAlertLoading
     * @private
     */
    _isAlertLoading: function(isAlertLoading) {
        this._skipRegionPanning = isAlertLoading;
    },

    /**
     * Listens to whether an alert is loaded and toggles the isAlertLoaded flag.
     * @param loadedAlert
     * @private
     */
    _loadedAlertChanged: function(loadedAlert) {
        this._setIsAlertLoaded(!!(loadedAlert && loadedAlert.template));
    }
});