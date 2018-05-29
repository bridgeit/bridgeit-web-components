Polymer({
    is: 'voyent-mobile-alert-editor',
    behaviors: [Voyent.AlertMapBehaviour,Voyent.AlertBehaviour],

    /**
     * Load the passed template at the specified coordinates.
     * @param template - The template JSON to be loaded.
     * @param coordinates - The coordinates in object form {lat:{{lat}},lng:{{lng}}}
     */
    loadAlert: function(template,coordinates) {
        var _this = this;
        //Clear the map of any loaded alert template before drawing.
        if (this._loadedAlert) {
            this.clearMap();
        }
        //Remove the parent's id from the record as we'll generate a new one.
        var id = template._id;
        delete template._id;
        //If we have a geometry then use the provided location as the alert center.
        var latLng = null;
        if (template.geo) {
            latLng = new google.maps.LatLng(coordinates);
        }
        template.state = 'draft'; //Default to draft
        //Set this flag so the center_changed listener will not fire for each circular zone that is drawn.
        this._ignoreZoneCenterChangedEvent = true;
        this._drawAndLoadAlertTemplate(template,latLng);
        console.log('setting parentId to:',id);
        this._loadedAlert.template.setParentId(id);
        //Populate the movement pane, async so the properties panel has time to initialize.
        setTimeout(function() {
            _this._ignoreZoneCenterChangedEvent = false;
        },0);
    },

    //******************PRIVATE API******************

    _onAfterLogin: function() {

    }

});