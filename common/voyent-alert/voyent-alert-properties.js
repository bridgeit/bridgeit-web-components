Polymer({
    is: "voyent-alert-properties",
    behaviors: [Voyent.AlertBehaviour],

    properties: {
        /**
         * Contains currently loaded _AlertTemplate object and the currently selected stack.
         * eg. { template:_AlertTemplate, selectedStack:_AlertZoneStack }
         */
        _loadedAlert: { type: Object, value: null, notify: true },
        /**
         * A container of data associated with the realm region boundary.
         */
        _areaRegion: { type: Array, value: null, notify: true }
    },

    observers: [
        '_zonesUpdated(_loadedAlert.selectedStack.zones.length)'
    ],

    ready: function() {
        this._renamingTemplate = false;
    },

    /**
     * Toggles renaming mode for an alert template.
     * @private
     */
    _toggleAlertTemplateRenaming: function() {
        var _this = this;
        this.set('_renamingTemplate',!this._renamingTemplate);
        if (this._renamingTemplate) {
            //Set the input to our current name value. We use a separate value for the input so we can easily revert.
            this.set('_templateNameVal',this._loadedAlert.template.name);
            //Focus on the input.
            setTimeout(function() {
                _this.querySelector('#alertTemplate').focus();
            },0);
        }
    },

    /**
     * Confirms or cancels the renaming of an alert template via enter and esc keys.
     * @param e
     * @private
     */
    _renameAlertTemplateViaKeydown: function(e) {
        //Prevent the event from bubbling.
        e.stopPropagation();
        if (e.which === 13) { //Enter
            this._renameAlertTemplate();
        }
        else if (e.which === 27) { //Esc
            this._toggleAlertTemplateRenaming();
        }
    },

    /**
     * Confirms changes made to the alert template name when losing focus on the input.
     * @param e
     * @private
     */
    _renameAlertTemplateViaBlur: function(e) {
        var _this = this;
        //Always execute this function async so we can correctly determine the activeElement.
        setTimeout(function() {
            //Check if we are focused on an iron-input because if we are it means focus is still on the input so we
            //won't exit editing mode. Additionally we'll check if we are in editing mode because if we are not
            //then it means that focus was removed via the Enter or Esc key press and not just a regular blur.
            if (document.activeElement.getAttribute('is') === 'iron-input' ||
                !_this._renamingTemplate) {
                return;
            }
            _this._renameAlertTemplate();
        },0);
    },

    /**
     * Confirms the renaming of an alert template.
     * @private
     */
    _renameAlertTemplate: function() {
        if (this._templateNameVal !== this._loadedAlert.template.name) {
            this._loadedAlert.template.setName(this._templateNameVal);
            this.set('_templateNameVal','');
            this.fire('voyent-alert-template-name-changed', {"name": this._loadedAlert.template.name});
        }
        //Toggle renaming mode.
        this._toggleAlertTemplateRenaming();
    },

    /**
     * Toggles renaming mode for Proximity Zones.
     * @param eOrI
     * @private
     */
    _toggleProximityZoneRenaming: function(eOrI) {
        //Prevent the event from bubbling.
        if (eOrI.stopPropagation) { eOrI.stopPropagation(); }
        var _this = this;
        //This function will either be passed an event (from the ui) or a direct index (from the JS).
        var i = eOrI.model ? eOrI.model.get('index') : eOrI;
        var zone = this._loadedAlert.selectedStack.getZoneAt(i);
        zone.setRenaming(!zone.renaming);
        if (zone.renaming) {
            //Set the input to our current name value. We use a separate value for the input so we can easily revert.
            this.set('_zoneNameVal',zone.name);
            //Focus on the input.
            setTimeout(function() {
                _this.querySelector('#zone-'+i).focus();
            },0);
        }
        else {
            //Always reset the input value so it updates each time editing mode is entered
            this.set('_zoneNameVal','');
        }
    },

    /**
     * Confirms or cancels the renaming of a Proximity Zone via enter and esc keys.
     * @param e
     * @private
     */
    _renameProximityZoneViaKeydown: function(e) {
        //Prevent the event from bubbling.
        e.stopPropagation();
        if (e.which === 13) { //Enter
            this._renameProximityZone(e);
        }
        else if (e.which === 27) { //Esc
            this._toggleProximityZoneRenaming(e);
        }
    },

    /**
     * Confirms changes made to the Proximity Zone name when losing focus on the input.
     * @param e
     * @private
     */
    _renameProximityZoneViaBlur: function(e) {
        var _this = this;
        //Always execute this function async so we can correctly determine the activeElement.
        setTimeout(function() {
            //Check if we are focused on an iron-input because if we are it means focus is still on the input so we
            //won't exit editing mode. Additionally we'll check if we are in editing mode because if we are not
            //then it means that focus was removed via the Enter or Esc key press and not just a regular blur.
            if (document.activeElement.getAttribute('is') === 'iron-input' ||
                  !_this._loadedAlert.selectedStack.getZoneAt(e.model.get('index')).renaming) {
                return;
            }
            _this._renameProximityZone(e);
        },0);
    },

    /**
     * Confirms the renaming of a Proximity Zone.
     * @param e
     * @private
     */
    _renameProximityZone: function(e) {
        var i = e.model.get('index');
        var zone = this._loadedAlert.selectedStack.getZoneAt(i);
        if (this._zoneNameVal !== zone.name) {
            zone.setName(this._zoneNameVal);
            this.set('_zoneNameVal','');
            this.fire('voyent-alert-zone-name-changed',{
                "id":zone.id,
                "name":zone.name
            });
            //Redraw the overlay since the content changed.
            zone.nameOverlay.draw();
        }
        //Toggle renaming mode.
        this._toggleProximityZoneRenaming(i);
    },

    /**
     * Adds a new proximity zone to the alert template. The new zone is 50% larger than the largest existing zone.
     * @private
     */
    _addProximityZone: function() {
        var newZone;
        //Set the new zone radius as 50% larger than the current largest zone
        //and de-increment the new zone zIndex so it sits behind the other zones.
        var largestZone = this._loadedAlert.selectedStack.getLargestZone();
        var zIndex = largestZone.zIndex - 1;
        var name = 'Zone_' + (this._loadedAlert.selectedStack.zones.length + 1);
        //Since we don't support mix and match zone types within a stack just
        //check what the first one is to determine which kind we want to add.
        if (this._loadedAlert.selectedStack.getZoneAt(0).getShape() === 'circle') {
            var radius = largestZone.shapeOverlay.getRadius() + largestZone.shapeOverlay.getRadius() * 0.5;
            newZone = new this._CircularAlertZone(radius,name,null,null,null,zIndex);
        }
        else { //polygon
            var largestZonePaths = largestZone.shapeOverlay.getPaths(), distance, bearing, paths = [], path;
            var centroid = this._AlertTemplate.calculateCentroidFromPaths(largestZonePaths);
            for (var i=0; i<largestZonePaths.length; i++) {
                path=[];
                for (var j=0; j<largestZonePaths.getAt(i).length; j++) {
                    //Calculate the distance and bearing from the center to each point.
                    distance = google.maps.geometry.spherical.computeDistanceBetween(centroid,largestZonePaths.getAt(i).getAt(j));
                    bearing = google.maps.geometry.spherical.computeHeading(centroid,largestZonePaths.getAt(i).getAt(j));
                    //Increase the distance by 50% to increase the size of the polygon the same.
                    distance += distance * 0.5;
                    //Calculate the new coordinate.
                    path.push(google.maps.geometry.spherical.computeOffset(centroid,distance,bearing));
                }
                paths.push(path);
            }
            //When we add a new zone we don't want to include the full shape so we can
            //punch it out properly later so just pass the filled outer shape via paths[0].
            newZone = new this._PolygonalAlertZone([paths[0]],name,null,null,null,zIndex);
        }
        this._loadedAlert.selectedStack.addZone(newZone);
        //Re-adjust the centroid for the template.
        this._loadedAlert.template.updateJSONAndCentroid();
        this.fire('voyent-alert-zone-added',{"id":newZone.id,"zone":newZone,"stack":this._loadedAlert.selectedStack});
    },

    /**
     * Removes a Proximity Zone from the alert template.
     * @private
     */
    _removeProximityZone: function(e) {
        //Prevent the event from bubbling.
        e.stopPropagation();
        var zone = this._loadedAlert.selectedStack.getZoneAt(e.model.get('index'));
        var id = zone.id;
        this._loadedAlert.selectedStack.removeZone(zone);
        this.fire('voyent-alert-zone-removed',{"id":id});
    },

    /**
     * Confirms or cancels the edit of a Proximity Zone property via enter and esc keys.
     * @param e
     * @private
     */
    _editPropertyViaKeydown: function(e) {
        //Prevent the event from bubbling.
        e.stopPropagation();
        if (e.which === 13 || e.which === 27) { //Enter & Escape.
            this._editProperty(e);
            //Close the colour picker.
            if (e.target.getAttribute('data-property') === 'colour') {
                var colorPicker = this.querySelector('#jsColor-'+e.model.get('index'));
                if (colorPicker) {
                    colorPicker.jscolor.hide();
                }
            }
        }
    },

    /**
     * Confirms the edit of a Proximity Zone property.
     * @param e
     * @private
     */
    _editProperty: function(e) {
        var zone = this._loadedAlert.selectedStack.getZoneAt(e.model.get('index'));
        //The properties are set directly into the properties since they are bound
        //in the template but to apply the changes we need to call our set functions.
        if (e.target.getAttribute('data-property') === 'colour') {
            zone.setColour(zone.colour);
        }
        else {
            zone.setOpacity(zone.opacity);
        }
    },

    /**
     * Monitors the number of zones that we the alert template has.
     * @param length
     * @private
     */
    _zonesUpdated: function(length) {
        this.set('_hasOneZone',!length || length === 1);
    },

    /**
     * Returns the style classes for the accordion header and body elements.
     * @param section
     * @param active
     * @returns {string}
     * @private
     */
    _getAccordionClasses: function(section,active) {
        return active ? (section+' active') : section;
    },

    /**
     * Returns the style classes for the accordion zone label.
     * @param active
     * @returns {string}
     * @private
     */
    _getZoneTitleClasses: function(active) {
        return active ? 'title zone active' : 'title zone';
    },

    /**
     * Returns the arrow icon to use for each accordion.
     * @param active
     * @returns {string}
     * @private
     */
    _getArrowIcon: function(active) {
        return active ? 'expand-more' : 'expand-less';
    }
});