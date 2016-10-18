Polymer({
	is: "voyent-process-demo",

    properties: {
        loggedIn: { type: Boolean, value: false, notify: true },
        /**
         * Defines the Voyent account of the realm.
         */
        account: { type: String },
        /**
         * Defines the Voyent realm to build actions for.
         */
        realm: { type: String },
        /**
         * Defines the Voyent host to use for services
         */
        host: { type: String, value: "dev.voyent.cloud", notify: true, reflectToAttribute: true },
        /**
         * Push group to attach and join automatically on valid initialization
         * The intent is to listen to the group the process is pushing status updates to
         */
        pushGroup: { type: String, value: "processDemoGroup", notify: true, reflectToAttribute: true },
        /**
         * Underlying model ID that we are interacting with
         */
        modelId: { type: String, value: null, notify: true, reflectToAttribute: true },
        /**
         * Chosen model from the dropdown
         */
        selectedModel: { type: String, notify: true, observer: '_modelChanged' },
        /**
         * If there is a choosable fork we store the value here
         */
        selectedFork: { type: String, notify: true },
        /**
         * Milliseconds to wait before moving to a synthetic event
         */
        waitBeforeEvent: { type: Number, value: 1200, notify: true, reflectToAttribute: true },
        /**
         * Milliseconds to wait before moving to the end element
         */
        waitBeforeEnd: { type: Number, value: 1500, notify: true, reflectToAttribute: true },
        /**
         * Internal global variable for our bpmn-io.js viewer
         */
        _viewer: { type: Object }
    },
    
    /**
     * Define our initial tool data structure for backing our UI controls
     */
	ready: function() {
	    // Some BPMN constants for different types
	    this.TYPE_START = "bpmn:StartEvent";
	    this.TYPE_END   = "bpmn:EndEvent";
	    this.TYPE_ARROW = "bpmn:SequenceFlow";
	    this.TYPE_EVENT = "bpmn:IntermediateCatchEvent";
	    this.TYPE_GATE  = "bpmn:ExclusiveGateway";
	    this.TYPE_OUTGOING = "bpmn:outgoing";
	    this.TYPE_INCOMING = "bpmn:incoming";
	    
	    // Our internal XML from the service
	    this.xml = null;
	    
	    // Used by the process to send events back
	    this.processId = null;
	    
	    // Disable notifications from displaying, as we just need them for payload
        voyent.notify.config.toast.enabled = false;
        voyent.notify.config.native.enabled = false;
	    
        // Default to no forks and no models
        this._forks = [];
        this._models = [];
	},
	
	/**
	 * Setup our component
	 * This will retrieve a list of stored BPMN, attach to push, and add a notificationsReceived listener
	 */
	initialize: function() {
        if (!this.realm) {
            this.realm = voyent.io.auth.getLastKnownRealm();
        }
        if (!this.account) {
            this.account = voyent.io.auth.getLastKnownAccount();
        }
        if (!voyent.io.auth.isLoggedIn()) {
            this.set('loggedIn', false);
            return;
        }
        
        // If we reached this far we are logged in
        this.set('loggedIn', true);
        
        // Notify the user
        this.fire('message-info', 'Initialized and prepared to start');
        
        // Load a list of saved BPMN models
        this._retrieveModels(true);
        
        // Attach and join the push group
        voyent.xio.push.attach('http://' + this.host + '/pushio/' + this.account + '/realms/' + this.realm, this.pushGroup);
    
        // Handle incoming notifications
        // We don't need to display the notifications, since updating our process model image will show the user enough
        var _this = this;
        document.addEventListener('notificationReceived',function(e) {
            // Clear our old highlights
            _this.clearHighlights();
            
            // Figure out the name and ID that we're trying to update
            var updateName = e.detail.notification.subject + ' ' + e.detail.notification.details;
            var updateId = null;
            var elements = _this._viewer.definitions.rootElements[0].flowElements;
            for (var i in elements) {
                if (updateName == elements[i].name) {
                    updateId = elements[i].id;
                    _this.highlightById(updateId);
                    break;
                }
            }
            
            // Now we need to determine what element is next
            // This is because we could have a synthetic event the user needs to manually click to fire
            if (updateId !== null) {
                if (!_this.xml) {
                    return;
                }
                
                _this._viewer.moddle.fromXML(_this.xml, function(err, definitions, parseContext) {
                    // Can't do much without references
                    if (parseContext.references) {
                        // First loop through and find the outgoing connection/flow from our highlighted item
                        var outgoingConn = null;
                        for (var loopRef in parseContext.references) {
                            var currentRef = parseContext.references[loopRef];
                            
                            if (currentRef.property && currentRef.element.id == updateId) {
                                if (currentRef.property == _this.TYPE_OUTGOING) {
                                    outgoingConn = currentRef.id;
                                    break;
                                }
                            }
                        }
                        
                        // Now we check what the outgoing connection attaches to
                        if (outgoingConn !== null) {
                            for (var loopRef in parseContext.references) {
                                var currentRef = parseContext.references[loopRef];
                                
                                // A match is: same id as outgoing connection, type is incoming, and the element type is an event or end
                                if (currentRef.id === outgoingConn) {
                                    if (currentRef.property == _this.TYPE_INCOMING) {
                                        var matchId = currentRef.element.id;
                                        
                                        if (currentRef.element.$type === _this.TYPE_EVENT) {
                                            
                                            // Wait and then manually highlight, enable click, and show a hint to the user for the synthetic event
                                            setTimeout(function() {
                                                _this.clearHighlights();
                                                _this.highlightById(matchId);
                                                
                                                var overlays = _this._viewer.get('overlays');
                                                var tooltipOverlay = overlays.add(matchId, {
                                                    position: {
                                                      top: 70,
                                                      left: -15
                                                    },
                                                    html: '<div class="bpmnTip">Click envelope to send event</div>'
                                                });
                                                
                                                var clickListener = function(e) {
                                                    eventNode.removeEventListener('click', clickListener);
                                                    overlays.remove(tooltipOverlay);
                                                    
                                                    _this.sendSynthEvent(currentRef.element.name);
                                                };
                                                
                                                var eventNode = document.querySelector('[data-element-id=' + matchId + ']');
                                                eventNode.addEventListener('click', clickListener);
                                            }, _this.waitBeforeEvent);
                                            
                                            break;
                                        }
                                        // If the next element is the end we just jump to it after a pause
                                        // Then we clear the highlights after a second pause
                                        else if (currentRef.element.$type === _this.TYPE_END) {
                                            setTimeout(function() {
                                                _this.clearHighlights();
                                                _this.highlightById(matchId);
                                            }, _this.waitBeforeEnd);
                                            
                                            setTimeout(function() {
                                                _this.clearHighlights();
                                            }, _this.waitBeforeEnd*2);
                                        }
                                    }
                                }
                            }
                        }
                    }
                });
            }
        });
	},
	
	/**
	 * Setup our BPMN diagram, using bpmn-io.js
	 * This will retrieve and load the diagram for our current this.modelId
	 */
	loadBPMN: function(logServiceError) {
	    // Get the XML for our model
	    var theUrl = this._makeURL("/models/" + this.modelId);
	    var validResponse = false;
        var xmlHttp = new XMLHttpRequest();
        xmlHttp.onreadystatechange = function receiveResponse(e) {
            if (this.readyState == 4) {
                validResponse = (this.status == 200);
            }
        };
        console.log("Retrieve model from: " + theUrl);
        xmlHttp.open("GET", theUrl, false);
        xmlHttp.send(null);
        
        // Ensure we have a valid response before continuing
        if (!validResponse) {
            if (logServiceError) {
                this.fire("message-error", "Failed to retrieve XML data for " + this.modelId + " from the service.");
            }
            return false;
        }
        
        // Parse our response
        var parsedJSON = JSON.parse(xmlHttp.responseText)[0];
        this.xml = parsedJSON.model;
        
        // Clear the div before adding the diagram, to prevent duplicates
        this._unloadBPMN();
        this.set('createMode', false);
        this.set('interactId', new String(this.modelId));
	    
	    // Setup our BPMN viewer and import the XML
        this._viewer = this._makeViewer();
        var _this = this;
        
        if (this.xml) {
            this._viewer.importXML(this.xml, function(err) {
              if (err) {
                  _this.fire("message-error", "Failed to render the BPMN diagram");
                  console.error("Error: ", err);
              }
              else {
                  // Generate any gateway fork options from the XML
                  _this._parseForks();
                  
                  // Zoom to center properly
                  _this._viewer.get("canvas").zoom('fit-viewport', 'auto');
                  
                  // Loop through and disable each event, to make the diagram read-only
                  var events = [
                      'element.hover',
                      'element.out',
                      'element.click',
                      'element.dblclick',
                      'element.mousedown',
                      'element.mouseup'
                  ];
                  var eventBus = _this._viewer.get('eventBus');
                  events.forEach(function(event) {
                      eventBus.on(event, 1500, function(e) {
                          e.stopPropagation();
                          e.preventDefault();
                      });
                  });
                  
                  // Polymer workaround to ensure the local styles apply properly to our dynamically generated SVG
                  _this.scopeSubtree(_this.$.bpmn, true);
                  
                  _this.fire('message-info', 'Loaded ' + parsedJSON.name + ' diagram');
              }
            });
        }
        else {
            _this.fire('message-error', 'Partial data found for "' + this.modelId + '" diagram, but missing model');
        }
        
        // When the window is resized update the zoom of the bpmn diagram to scale
        window.addEventListener('resize', function() {
            _this._viewer.get('canvas').zoom('fit-viewport', 'auto');
        });
	},
	
	/**
	 * Persist the current BPMN diagram to our service
	 * This function will determine if this saves a new record (POST) or updates an existing one (PUT)
	 */
	saveBPMN: function() {
	    // If we don't have an underlying modelId the user is just clicking save without anything in the viewer, so abandon
	    if (this.modelId === null) {
	        this.fire('message-info', 'No diagram to save');
	        return false;
	    }
	    
	    // If we don't have an interactId that means the field is blank in the UI, so abandon
	    if (!this.interactId || this.interactId == null || this.interactId.toString().trim().length === 0) {
	        this.set('interactId', 'required');
	        this.fire('message-error', 'Diagram ID is required to save');
	        return false;
	    }
	    
	    // Determine if we're saving a new diagram or updating an existing one
	    // If we're in create mode we're doing the former
	    // Otherwise we are updating, UNLESS our modelId and interactId (editable by the user) are different
	    var persistNew = false;
	    var saveId = this.modelId;
	    if (this.createMode) {
	        persistNew = true;
	    }
	    else if (this.modelId.toString() !== this.interactId.toString()) {
            persistNew = true;
            saveId = this.interactId;
	    }
	    
	    this._saveToXML(saveId, persistNew);
	},
	
	/**
	 * Create a new, blank BPMN diagram with a default ID/title
	 */
	createBPMN: function() {
	    this._unloadBPMN();
	    
	    // Ensure we have a unique default name
	    var defaultId = this._makeUniqueId('new-diagram');
	    this.set('modelId', defaultId);
	    this.set('interactId', defaultId);
	    this.set('selectedModel', null);
	    this.set('createMode', true);
	    this.set('_viewer', this._makeViewer());
	},
	
	/**
	 * Delete the current BPMN diagram from our service
	 * This function will confirm with the user before proceeding
	 */
	deleteBPMN: function() {
	    if (this.modelId === null) {
	        this.fire('message-info', 'No diagram to delete');
	        return false;
	    }
	    
	    var confirm = window.confirm('Are you sure you want to delete the "' + this.modelId + '" diagram?');
	    if (!confirm) {
	        return;
	    }
	    
	    var _this = this;
	    voyent.$.doDelete(this._makeURL("/models/" + this.modelId)).then(function(response){
            _this.fire('message-info', 'Successfully deleted the "' + _this.modelId + '" diagram');
	            
            _this._unloadBPMN();
            _this.set('_viewer', null);
            _this.set('selectedModel', null);
            _this.set('modelId', null);
            
            _this._retrieveModels(false);
        })['catch'](function(error) {
            _this.fire('message-error', 'Failed to delete the "' + _this.modelId + '" diagram');
            console.error("Error: ", error);
        });
	},
	
	/**
	 * Clear the current BPMN diagram, which means resetting various state elements
	 */
	clearBPMN: function() {
	    this._unloadBPMN();
	    this.set('_viewer', null);
        this.set('selectedModel', null);
        this.set('modelId', null);
	},
	
	/**
	 * Execute a process instance for a BPMN model
	 */
	startProcess: function() {
        // Clear old highlights
        this.clearHighlights();
        
        // Find our start event and highlight
        var start = this._getIdByType(this.TYPE_START);
        if (start && start.length > 0) {
            this.highlightById(start[0]);
        }
        
        // Then post to start the process, which should end up with us receiving status notifications
        var _this = this;
        voyent.$.post(this._makeURL("/processes/" + this.modelId)).then(function(response){
            _this.set('processId', response.processId);
            _this.fire('message-info', "Executed process '" + response.processName + "'");
        });
	},
	
	/**
	 * Trigger a synthetic event to our service
	 * Normally used in the process diagram to easily simulate outside events
	 */
	sendSynthEvent: function(eventName) {
	    // Note the data parameters are case sensitive based on what the Process Service uses
        var event = {
            time: new Date().toISOString(),
            service: 'voyent-process-demo',
            event: eventName,
            type: 'synthetic-message-event-withProcessId',
            processId: this.processId,
            data: {
                'Fork': this.selectedFork,
                'target': 'process'
            }
        };
        
        // Debug infos
        console.log("Going to send event '" + eventName + "' with process ID " + this.processId + " and fork " + this.selectedFork);
        
        var _this = this;
	    voyent.io.event.createCustomEvent({ "event": event }).then(function() {
            _this.fire('message-info', "Successfully sent event '" + eventName + "'"); 
	    }).catch(function(error) {
	        _this.fire('message-error', "Failed to send event '" + eventName + "'");
	    });
	},
	
	/**
	 * Apply the 'highlight' class via a marker to an element matching the passed ID in our BPMN viewer
	 */
	highlightById: function(id) {
	    if (id) {
	        this._viewer.get("canvas").addMarker(id, 'highlight');
	    }
	},
	
	/**
	 * Loop through all elements in the BPMN viewer and clear any highlight markers
	 */
	clearHighlights: function() {
        var elements = this._viewer.definitions.rootElements[0].flowElements;
        var canvas = this._viewer.get("canvas");
        for (var i in elements) {
            if (elements[i].$type !== this.TYPE_ARROW) {
                canvas.removeMarker(elements[i].id, 'highlight');
            }
        }
	},
	
	/**
	 * Check our BPMN viewer data definitions to try to find a list of matching IDs for the passed type
	 * An example of a passed type is bpmn:StartEvent
	 */
	_getIdByType: function(type) {
	    if (!type) {
	        return [];
	    }
	    
        var elements = this._viewer.definitions.rootElements[0].flowElements;
        var toReturn = [];
        for (var i in elements) {
            if (type == elements[i].$type) {
                toReturn.push(elements[i].id);
            }
        }
        return toReturn;
	},
	
	/**
	 * Determine if our current BPMN has any forks
	 * These would come from ExclusiveGateways
	 * If we find a gate/decision point this function will parse the outcomes and populate a list of forks
	 * The forks can be chosen by the user at runtime when they execute a process
	 */
	_parseForks: function() {
	    var _this = this;
	    this._viewer.moddle.fromXML(this.xml, function(err, definitions, parseContext) {
              if (parseContext.references) {
                  var outgoingConns = [];
                  for (var loopRef in parseContext.references) {
                      var currentRef = parseContext.references[loopRef];
                      
                      if (currentRef.element.$type == _this.TYPE_GATE) {
                          if (currentRef.property == _this.TYPE_OUTGOING) {
                              outgoingConns.push(currentRef.id);
                          }
                      }
                  }
                  
                  if (outgoingConns.length > 0) {
                      _this.set('_forks', []);
                      for (var loopRef in parseContext.references) {
                          var currentRef = parseContext.references[loopRef];
                          
                          if (outgoingConns.indexOf(currentRef.id) !== -1) {
                              if (currentRef.property == _this.TYPE_INCOMING) {
                                  // Some manual tweaking to remove "Update Status" for a known use case
                                  if (currentRef.element.name.indexOf("Update Status") !== -1) {
                                      _this.push('_forks', currentRef.element.name.replace("Update Status", ""));
                                  }
                                  else {
                                      _this.push('_forks', currentRef.element.name);
                                  }
                              }
                          }
                      }
                      
                      if (_this._forks.length > 0) {
                          _this.set('selectedFork', _this._forks[0]);
                      }
                  }
              }
        });
	},
	
	/**
	 * Retrieve a list of saved BPMN models from our service
	 *
	 * @param autoload true to automatically load if there is only one BPMN diagram retrieved (generally meant for first page display only)
	 */
	_retrieveModels: function(autoload) {
	    // Reset our model list first
	    this.set('_models', []);
	    
        var _this = this;
        voyent.$.get(this._makeURL("/models")).then(function(response){
            if (response) {
                var jsonResponse = JSON.parse(response);
                for (var loopModel in jsonResponse) {
                    _this.push('_models', jsonResponse[loopModel]._id);
                }
                
                // If we only have a single model load it immediately
                // Only allowed if passed autoload=true
                if (autoload) {
                    if (_this._models.length === 1) {
                        _this.set('selectedModel', _this._models[0]);
                    }
                }
            }
        });
	},
	
	hasModel: function(toCheck) {
	    return toCheck !== null;
	},
	
	/**
	 * Unload the state of our BPMN diagram
	 * This means resetting our _forks (and selectedFork)
	 * We also clear the interactId field
	 * And finally the BPMN svg from the viewer is removed
	 */
	_unloadBPMN: function() {
	    this.set('_forks', []);
	    this.set('selectedFork', null);
	    this.set('interactId', null);
	    
	    document.getElementById("bpmn").innerHTML = '';
	},
	
	/**
	 * Underlying function to save the current BPMN viewer state to XML
	 * This XML will then be persisted (either save or update) to our service
	 *
	 * @param saveId to save against
	 * @param persistNew true to create a new record, false to update existing
	 */
	_saveToXML: function(saveId, persistNew) {
	    var _this = this;
        this._viewer.saveXML({ format: true }, function (err, xml) {
            var data = {
                "name": saveId,
                "model": xml
            };
            
            if (persistNew) {
                voyent.$.post(_this._makeURL("/models/" + saveId), data).then(function(response){
                    _this._retrieveModels(false);
                    
                    _this.fire('message-info', 'Successfully saved the "' + saveId + '" diagram');
                })['catch'](function(error) {
                    _this.fire('message-error', 'Failed to save the "' + saveId + '" diagram');
                });
            }
            else {
                voyent.$.put(_this._makeURL("/models/" + saveId), data).then(function(response){
                    _this._retrieveModels(false);
                    
                    _this.fire('message-info', 'Successfully updated the "' + saveId + '" diagram');
                })['catch'](function(error) {
                    _this.fire('message-error', 'Failed to update the "' + saveId + '" diagram');
                });
            }
        });
    },
	
	/**
	 * Return a URL to the Process service for our current host, account, realm, and access token
	 */
	_makeURL: function(addition) {
	    return 'http://' + this.host + '/process/' + this.account + '/realms/' + this.realm + addition + '?access_token=' + voyent.io.auth.getLastAccessToken();
	},
	
	/**
	 * Setup a BPMN viewer with some default options
	 */
	_makeViewer: function() {
	    var BpmnViewer = window.BpmnJS;
	    return new BpmnViewer({
            container: '#bpmn',
            zoomScroll: { enabled: false }
        });
	},
	
	/**
	 * Create a unique model ID that doesn't exist in our current _models list
	 * This function is rather rudimentary and will just append the current milliseconds and try again
	 */
	_makeUniqueId: function(base) {
	    if (this._models && this._models.length > 0) {
	        for (var loopModel in this._models) {
	            if (this._models[loopModel].toString() == base) {
	                return this._makeUniqueId(base + new Date().getMilliseconds());
	            }
	        }
	    }
	    return base;
	},
	
	/**
	 * Function called when the selected BPMN model is changed
	 * This would mainly fire when a user selects an option from the "stored BPMN" CRUD list
	 */
	_modelChanged: function() {
	    if (this.selectedModel && this.selectedModel !== null) {
	        this.set('modelId', new String(this.selectedModel));
            this.loadBPMN();
        }
	}
});