Polymer({
	is: "voyent-action-editor",
    behaviors: [Voyent.ActionBehavior],

    properties: {
        /**
         * Defines the Voyent account of the realm.
         * @default voyent.auth.getLastKnownAccount()
         */
        account: { type: String },
        /**
         * Defines the Voyent realm to build actions for.
         * @default voyent.auth.getLastKnownRealm()
         */
        realm: { type: String },
        /**
         * Defines how much top padding (without units) we want for the sidebar (containing actions / tasks)
         * This is because the sidebar will "sticky scroll" to always be in view
         * But we might have an absolutely positioned header or similar that we want to account for
         */
        barpad: { type: Number, value: 0, reflectToAttribute: true, notify: true }
    },

    /**
     * Fired after the actions list is retrieved, this occurs on the initial load and whenever a CRUD operation is performed. Contains the list of saved actions.
     * @event actionsRetrieved
     */
	ready: function() {
        if (!this.realm) {
            this.realm = voyent.auth.getLastKnownRealm();
        }
        if (!this.account) {
            this.account = voyent.auth.getLastKnownAccount();
        }
        if (voyent.auth.isLoggedIn()) {
            this.initialize();
        }
        this._loadedAction = null;
        this._taskGroups = [];

        // Setup our sidebar to scroll alongside the action editor
        // This is necessary in case the action editor is quite long (such as many tasks)
        // Because we still want to see the draggable containers/tasks list
        this.offset = -1;
        this.lastScroll = -1;
        var _this = this;
        window.addEventListener("scroll", function() {
            var ourDiv = document.getElementById("fixedDiv");

            if (ourDiv) {
                // This offset would sometimes enter a race condition with initialization
                // Where the offset would calculate BEFORE the entire page was loaded, specifically the content above the action editor
                // This lead the scrolling palette to "sticky" to the top incorrectly
                // Namely because it thought the top of the action editor was higher on the page (aka lower offsetTop, like 300) instead of the correct value of ~600
                // To solve this we will store the highest offsetTop we can find, which means if we incorrectly get set to 300 we will override with 600
                if (_this.offset < ourDiv.offsetTop) {
                    _this.offset = ourDiv.offsetTop;
                }

                // Next calculate our scrollbar position
                var compareTop = _this._calculateScrollbarPos(ourDiv.parentNode);

                // Skip out if our comparison is the same as our last scroll
                // This most likely happens when an unrelated scrollbar (rather than the main container) is used
                if (compareTop === _this.lastScroll) {
                    return;
                }
                _this.lastScroll = compareTop;

                // There is a chance we need to resize our left pane contents a bit
                // This would be necessary when the viewport is smaller than our left pane
                // If we don't do this the left pane will sticky to the top and make it so the user can never reach the bottom
                var h = window.innerHeight || document.documentElement.clientHeight || document.body.clientHeight;
                if (h) {
                    // Get all left pane contents
                    var panes = document.querySelectorAll(".leftPane");

                    // Note we only want to bother looping our panes if we have the exact right amount
                    // This is a bit of a magic number, but refers to the container and item panes on the left
                    // So we know there are exactly 2 of them
                    if (panes.length === 2) {
                        for (var i = 0; i < panes.length; i++) {
                            // Calculate a height to 40% of the total page
                            // Between the two panels this leaves a padding buffer of 20%
                            var calcH = Math.round(h*0.4);
                            panes[i].style.height = null;

                            // If we are below a bare minimum of 100px reset to 100 and force the height
                            if (calcH < 100) {
                                calcH = 100;

                                panes[i].style.height = calcH + 'px';
                            }

                            // Set the max height to our calculated value
                            panes[i].style.maxHeight = calcH + 'px';
                        }
                    }
                }

                // Use the unstickied version by default
                ourDiv.style.position = 'relative';
                ourDiv.style.top = null;

                // Only bother to sticky the container if our main content is big enough to need it
                // Similarly only sticky if our viewport is big enough that the user won't get stuck scrolling
                if ((document.getElementById("aeMain").clientHeight > ourDiv.clientHeight) &&
                    (h >= ourDiv.clientHeight)) {
                    // If the top of our scroll is beyond the sidebar offset it means
                    // the sidebar would no longer be visible
                    // At that point we switch to a fixed position with a top of 0
                    // We will reverse this process if the sidebar would naturally be visible again
                    // This is necessary beyond a standard "position: fixed" to ensure the sidebar doesn't
                    // stay fixed to the top of the page when it doesn't need to
                    // Note we include our "barpad" attribute, to ensure the shifting happens right away
                    if ((compareTop+_this.barpad) > _this.offset) {
                        ourDiv.style.position = 'fixed';
                        ourDiv.style.top = _this.barpad + 'px';
                    }
                }
            }
        }, true);
	},

    /**
     * If authentication is not provided on component load then this function can be used to initialize the component.
     */
    initialize: function() {
        this._loadQueryEditor();
        this.getTaskItems();
        this.getActions();
    },

    /**
     * Fetch the list of available task groups and tasks from the Acton Service.
     */
    getTaskItems: function() {
        var _this = this;
        var promises = [];
        promises.push(voyent.action.getTaskGroups({"realm":this.realm}).then(function(schemas) {
            _this._processSchemas(schemas,'_taskGroupSchemas');
        }));
        promises.push(voyent.action.getTasks({"realm":this.realm}).then(function(schemas) {
            var key = '_taskSchemas';
            _this._processSchemas(schemas,key);

            // We also want to group/organize the tasks
            // Unfortunately we have to hardcode some of the services here until the meta is updated
            // We use a separate map for this so we don't interfere with existing functionality, just the display on the page
            _this._organizeSchemas(_this[key],key);
        }));
        return Promise.all(promises).then(function() {
            //since the editor div is included dynamically in the
            //template it's possible that it hasn't rendered yet
            var checkExist = setInterval(function() {
                if (_this.$$('#eventHandlerEditor')) {
                    _this.$$('#eventHandlerEditor').appendChild(_this._queryEditorRef);
                    clearInterval(checkExist);
                }
            },10);
        })['catch'](function(error) {
            _this.fire('message-error', "Error in getTaskItems: " + error);
            console.error('Error in getTaskItems:',error);
        });
    },

    /**
     * Fetch the list of previously created actions.
     */
    getActions: function() {
        var _this = this;
        voyent.action.findActions({"realm":this.realm}).then(function(actions) {
            //save the list of action IDs so we can check for uniqueness
            _this._actionIds = actions.map(function(action) {
                return action._id;
            });
            _this.fire('actionsRetrieved',{actions:actions});
            _this._getHandlers();
        }).catch(function(error) {
            _this.fire('message-error', "Error in getActions: " + error);
            console.error('Error in getActions:',error);
        });
    },

    /**
     * Load an action into the editor from JSON format.
     * @param action
     * @param callback
     */
    loadAction: function(action, callback) {
        var _this = this;
        // First reset our task groups, mainly to toggle the state of task group collapsed/opened
        this.set('_taskGroups', []);

        // Then do our load in a set timeout
        // This is also necessary to update any select components in the action to their properly loaded value
        setTimeout(function() {
            _this._loadHandler(action._id);
            _this._loadedAction = JSON.parse(JSON.stringify(action));  //clone object (it is valid JSON so this technique is sufficient)
            _this._taskGroups = _this._convertActionToUI(_this._loadedAction);
            _this.set('_taskGroups',JSON.parse(JSON.stringify(_this._taskGroups)));
            setTimeout(function() {
                //do this async so we are sure the action is loaded
                _this._updateSelectMenus();
            });
            _this.fire('message-info', 'Loaded action ' + _this._loadedAction._id + ' with ' + _this._taskGroups.length + ' task groups');
            if (callback) {
                callback();
            }
        },0);
    },

    /**
     * Save a new action. Provide an id to override the value specified in the UI.
     * @param actionId
     */
    saveAction: function(actionId) {
        var _this = this;
        actionId = actionId && actionId.trim().length > 0 ? actionId : this._actionId;
        if (!this.validateAction() || !this.isUniqueActionId(actionId)) {
            return;
        }
        var action = this.convertUIToAction();
        action._id = actionId;
        voyent.action.createAction({"realm":this.realm,"id":actionId,"action":action}).then(function() {
            _this._loadedAction = action;
            _this.getActions(); //refresh actions list
            _this._saveHandler(actionId);
            _this.fire('message-info', 'Successfully saved ' + _this._loadedAction._id + ' action');
        }).catch(function(error) {
            _this.fire('message-error', "Error in saveAction: " + error);
            console.error('Error in saveAction:',error);
        });
    },

    /**
     * Overwrite a previously saved action.
     */
    updateAction: function() {
        var _this = this;
        if (!this._loadedAction || !this.validateAction()) {
            return;
        }
        //check if the id has changed, if it has we must re-create the action with the new id
        if (this._actionId != this._loadedAction._id) {
            this._deleteAndSaveAction();
        }
        else {
            var action = this.convertUIToAction();
            voyent.action.updateAction({"realm":this.realm,"id":this._actionId,"action":action}).then(function() {
                _this.getActions(); //refresh actions list
                _this._updateHandler(_this._actionId);
                _this.fire('message-info', 'Successfully updated ' + _this._actionId + ' action');
            }).catch(function(error) {
                _this.fire('message-error', "Error in updateAction: " + error);
                console.error('Error in updateAction:',error);
            });
        }
    },

    /**
     * Delete the action from the Action Service.
     * @param id
     */
    deleteAction: function(id) {
        var _this = this;
        voyent.action.deleteAction({"realm":this.realm,id:id}).then(function() {
            _this.resetEditor();
            _this.getActions(); //refresh actions list
            _this._deleteHandler(id);
            _this.fire('message-info', 'Successfully deleted action ' + id);
        }).catch(function(error) {
            _this.fire('message-error', "Error in deleteAction: " + error);
            console.error('Error in deleteAction:',error);
        });
    },

    /**
     * Reset the editor.
     */
    resetEditor: function() {
        this._taskGroups = [];
        this._actionId = '';
        this._actionDesc = '';
        this._loadedAction = null;
        this._queryEditorRef.resetEditor();
        this._handlerIsActive = false;
    },

    /**
     * Validate the action against the task schemas.
     * @returns {boolean}
     */
    validateAction: function() {
        //validate handler query
        if (!this._queryEditorRef.validateQuery()) {
            this.fire('message-error', 'Enter a valid query.');
            console.error('Enter a valid query.');
            return false;
        }
        //validate required fields
        /* This approach fails for unknown reasons when loading multiple actions consecutively
           so reverting back to a plain loop that checks the value of each required field
        if (!this.$$('#actionForm').checkValidity()) {
            this.fire('message-error', 'Enter all required fields.');
            console.error('Enter all required fields.');
            return false;
        }*/
        var required = Polymer.dom(this.$$('#actionForm')).querySelectorAll('input:required');
        var groupIndex;
        for (var h=0; h<required.length; h++) {
            if (!required[h].value) {
                var label = required[h].getAttribute('data-label');
                var groupId = required[h].getAttribute('data-group-id');
                var taskId = required[h].getAttribute('data-task-id');
                var groupStr,taskStr;
                if (groupId) {
                    groupIndex = this._stripIndex(groupId);
                    groupStr = this._taskGroups[groupIndex].name || 'Task Group #'+(groupIndex+1).toString();
                }
                if (taskId) {
                    var taskIndex = this._stripIndex(taskId);
                    taskStr = this._taskGroups[groupIndex].tasks[taskIndex].name || 'Task #'+(taskIndex+1).toString();
                }
                var alertStr = 'You must define "' + label+'"';
                if (groupStr || taskStr) {
                    alertStr += '\n\n [' + (groupStr ? (groupStr) : '') + (taskStr ? (' > '+taskStr) : '') + ' > ' + label+']';
                }
                this.fire('message-error', alertStr);
                console.error(alertStr);
                required[h].focus();
                return false;
            }
        }
        var hasTasks = false;
        var taskGroupNames=[];
        for (var i=0; i<this._taskGroups.length; i++) {
            //make sure we have at least one task defined in each task group
            var tasks = this._taskGroups[i].tasks;
            if (tasks.length === 0) {
                continue;
            }
            hasTasks = true;
            //task group names need to be unique
            if (taskGroupNames.indexOf(this._taskGroups[i].name) > -1) {
                this.fire('message-error', 'Task group names must be unique, found duplicate name of "' + this._taskGroups[i].name +'"');
                console.error('Task group names must be unique, found duplicate name of "' + this._taskGroups[i].name +'"');
                return false;
            }
            taskGroupNames.push(this._taskGroups[i].name);
            var taskNames=[];
            for (var j=0; j<tasks.length; j++) {
                //task names need to be unique within the same task group
                if (taskNames.indexOf(tasks[j].name) > -1) {
                    this.fire('message-error', 'Task names must be unique within a task group, found duplicate name of "' + tasks[j].name +'" in "'+ this._taskGroups[i].name +'"');
                    console.error('Task names must be unique within a task group, found duplicate name of "' + tasks[j].name +'" in "'+ this._taskGroups[i].name +'"');
                    return false;
                }
                taskNames.push(tasks[j].name);

                //pull out the values for the oneOf fields and group the values for each group together before processing
                var oneOfGroups;
                if (tasks[j].schema.properties.oneOf) {
                    oneOfGroups = tasks[j].schema.properties.oneOf.map(function(group) {
                        return this._toArray(group).map(function(property) {
                            return property.value;
                        });
                    }.bind(this));
                }
                if (!oneOfGroups) {
                    continue;
                }
                //validate oneOf
                var someGroupDefined=false;
                var allGroupDefined=false;
                for (var k=0; k<oneOfGroups.length; k++) {
                    var definedCount=0;
                    var propertyVal = oneOfGroups[k];
                    for (var l=0; l<propertyVal.length; l++) {
                        if (propertyVal[l] && propertyVal[l].toString().trim().length > 0) {
                            definedCount++;
                        }
                    }
                    if (definedCount > 0) {
                        if (someGroupDefined) {
                            this.fire('message-error', 'You must define only one of the property groups in "' + this._taskGroups[i].name +'" > "' + tasks[j].name + '"');
                            console.error('You must define only one of the property groups in "' + this._taskGroups[i].name +'" > "' + tasks[j].name + '"');
                            return false;
                        }
                        someGroupDefined=true;
                        if (definedCount == propertyVal.length) {
                            allGroupDefined=true;
                        }
                    }
                }
                if (!allGroupDefined && someGroupDefined) {
                    this.fire('message-error', 'You must define all properties for the property group in "' + this._taskGroups[i].name +'" > "' + tasks[j].name + '"');
                    console.error('You must define all properties for the property group in "' + this._taskGroups[i].name +'" > "' + tasks[j].name + '".');
                    return false;
                }
                else if (!someGroupDefined) {
                    this.fire('message-error', 'You must define at least one of the property groups in "' + this._taskGroups[i].name +'" > "' + tasks[j].name + '"');
                    console.error('You must define at least one of the property groups in "' + this._taskGroups[i].name +'" > "' + tasks[j].name + '"');
                    return false;
                }
            }
        }
        if (!hasTasks) {
            this.fire('message-error', 'You must define at least one task');
            console.error('You must define at least one task');
            return false;
        }
        return true;
    },

    /**
     * Check if the id is unique.
     * @param actionId
     * @returns {boolean}
     */
    isUniqueActionId: function(actionId) {
        if (this._actionIds.indexOf(actionId) > -1) {
            this.fire('message-error', 'This Action ID is already in use, try a different one');
            console.error('This Action ID is already in use, try a different one');
            return false;
        }
        return true;
    },

    /**
     * Convert the editor state into a JSON action.
     * @returns {{}}
     */
    convertUIToAction: function() {
        var _this = this;
        var action = {"_id": this._actionId};
        if (this._actionDesc && this._actionDesc.trim().length > 0) {
            action.desc = this._actionDesc;
        }
        var taskGroups = JSON.parse(JSON.stringify(this._taskGroups)); //clone array (it is valid JSON so this technique is sufficient)
        for (var i=0; i<taskGroups.length; i++) {
            taskGroups[i].type = taskGroups[i].schema.title; //move title to type property
            processTaskGroups(taskGroups[i]);
            //cleanup values that aren't used in the action
            delete taskGroups[i].id;
            delete taskGroups[i].schema;

            var tasks = taskGroups[i].tasks;
            //always define an elseTasks for conditional task groups since it is required
            if (taskGroups[i].type === 'conditional-taskgroup') {
                taskGroups[i].elseTasks = [];
            }
            for (var j=tasks.length-1; j>=0; j--) {
                tasks[j].params = {}; //create action params object
                tasks[j].type = tasks[j].schema.title; //move title to type property
                processTasks(tasks[j]);
                if (!tasks[j].schema.isElseTask) {
                    //cleanup values that aren't used in the action
                    delete tasks[j].id;
                    delete tasks[j].schema;
                }
                else {
                    //we have a conditional task group and an else task so move the task item to the elseTasks list
                    taskGroups[i].elseTasks.push(tasks[j]);
                    taskGroups[i].tasks.splice(j,1);
                    //cleanup values that aren't used in the action
                    delete taskGroups[i].elseTasks[taskGroups[i].elseTasks.length-1].id;
                    delete taskGroups[i].elseTasks[taskGroups[i].elseTasks.length-1].schema;
                }
            }
            //since we looped backwards (to accommodate the splice) the elseTasks will be in the reverse order
            if (taskGroups[i].elseTasks) {
                taskGroups[i].elseTasks.reverse();
            }
        }
        action.taskGroups = taskGroups;
        return action;

        function processTaskGroups(taskGroup) {
            _this._processProperties(taskGroup.schema.properties,function(type,propName,property) {
                //move the values of each property in the schema directly into the task group
                if (typeof property.value !== 'undefined' && property.value.toString().trim().length > 0) {
                    taskGroup[property.title] = property.value;
                }
            });
        }
        function processTasks(task) {
            _this._processProperties(task.schema.properties,function(type,propName,property) {
                //move the values of each property in the schema to the params object
                if (typeof property.value !== 'undefined' && property.value.toString().trim().length > 0) {
                    task.params[property.title] = property.value;
                }
            });
        }
    },


    //******************PRIVATE API******************

    /**
     * Do some processing on the task group / task schemas so they can be used to easily render out the template.
     * @param schemas
     * @param key
     * @private
     */
    _processSchemas: function(schemas,key) {
        for (var i=0; i<schemas.length; i++) {
            //remove redundant '-taskgroup' and '-task' from task item label
            schemas[i].label = schemas[i].title.replace(/-taskgroup|-task/g,'');
            //do some pre-processing on the schema definition of oneOf properties
            var oneOfProps={};
            if (schemas[i].oneOf) {
                //collapse the oneOf properties into a single object with the
                //oneOf property as the key and the oneOf group # as the index
                for (var j=0; j<schemas[i].oneOf.length; j++) {
                    for (var k=0; k<schemas[i].oneOf[j].required.length; k++) {
                        oneOfProps[schemas[i].oneOf[j].required[k]] = j;
                    }
                }
            }
            var properties = schemas[i].properties;
            var isOptional;
            for (var prop in properties) {
                if (!properties.hasOwnProperty(prop)) {
                    continue;
                }
                isOptional=true;
                //add value directly to property in schema so it can be used for data binding
                if (properties[prop].type === 'string') {
                    //properties[prop].value = properties[prop].default ? properties[prop].default : '';
                    properties[prop].value = '';
                }
                else  if (properties[prop].type === 'boolean') {
                    properties[prop].value = !!properties[prop].default;
                }

                //group the required properties under required object
                if (schemas[i].required && schemas[i].required.indexOf(prop) > -1) {
                    if (!properties.required) {
                        properties.required = {};
                    }
                    properties.required[prop] = properties[prop];
                    isOptional=false;
                }
                //group the oneOf properties under a oneOf array (so we can render the fieldset groups)
                if (oneOfProps.hasOwnProperty(prop)) {
                    if (!properties.oneOf) {
                        properties.oneOf = {};
                    }
                    if (!properties.oneOf[oneOfProps[prop]]) {
                        //use object initially so we are sure we place the oneOf properties into the correct groups
                        properties.oneOf[oneOfProps[prop]] = {};
                    }
                    properties[prop].oneOfGroupNum = oneOfProps[prop];
                    properties.oneOf[oneOfProps[prop]][prop] = properties[prop];
                    isOptional=false;
                }
                //group the optional properties under optional object
                if (isOptional) {
                    if (!properties.optional) {
                        properties.optional = {};
                    }
                    properties.optional[prop] = properties[prop];
                }
                delete properties[prop];
            }
            if (properties.oneOf) { //convert oneOf to array of objects, each object representing a oneOf group
                properties.oneOf = this._toArray(properties.oneOf);
            }
            //cleanup parts of schema we don't need
            delete schemas[i].$schema;
            delete schemas[i].type;
            delete schemas[i].required;
            delete schemas[i].oneOf;
        }
        //save modified schemas to _taskSchemas or _taskGroupSchemas
        this[key] = schemas;

        //map schema array to title property so we can easily find schemas later
        var schemaMap = {};
        schemas.forEach(function (schema) {
            schemaMap[schema.title] = schema;
        });
        //save schema mapping to _taskSchemasMap or _taskGroupSchemasMap
        this[key+'Map'] = schemaMap;
    },

    /**
     * An additional step of processing for task schemas specific to the UI
     * For readability we want to group the tasks into a few service groups
     * This is done purely for the UI, so we still back the template with our core schemas created in processSchemas
     * @param schemas
     * @param key
     * @private
     */
    _organizeSchemas: function(schemas,key) {
        // We use 4 hardcoded services to sort: doc, locate, user, scope
        // Anything else goes into misc
        var defaultService = 'misc';
        var serviceArray = [ { label: 'doc', schemas: [] },
                             { label: 'locate', schemas: [] },
                             { label: 'user', schemas: [] },
                             { label: 'scope', schemas: [] },
                             { label: defaultService, schemas: [] } ];

        // Loop through the passed list of schemas, which would be the tasks
        for (var i=0; i<schemas.length; i++) {
            var currentSchema = schemas[i];
            var hasMatch = false;

            // For each schema we want to find if it matches a service
            // If not we'll default to using the "misc" group
            for (var s=0; s<serviceArray.length; s++) {
                if (currentSchema.label.indexOf(serviceArray[s].label) === 0) {
                    hasMatch = true;

                    // Add a UI label that removes the group name from the label
                    // For example locate-dir just becomes dir
                    // We can fairly safely assume there will be a dash in the service name, but we double check just in case
                    if (currentSchema.label.indexOf('-') > -1) {
                        currentSchema.labelUI =
                            currentSchema.label.substring(
                                currentSchema.label.indexOf(serviceArray[s].label + '-')+serviceArray[s].label.length+1);
                    }
                    else {
                        currentSchema.labelUI =
                            currentSchema.label.substring(
                                currentSchema.label.indexOf(serviceArray[s].label)+serviceArray[s].label.length);
                    }

                    // Add the modified schema to our service array for use in the UI
                    serviceArray[s].schemas.push(currentSchema);

                    break;
                }
            }

            // If we don't have a match just add to our "misc" service group
            if (!hasMatch) {
                for (var j=0; j<serviceArray.length; j++) {
                    if (serviceArray[j].label === defaultService) {
                        // Duplicate our unformatted label into labelUI
                        currentSchema.labelUI = currentSchema.label;

                        serviceArray[j].schemas.push(currentSchema);
                        break;
                    }
                }
            }
        }

        // We store this UI specific list of schemas in an appropriately named map
        // This map will then be used in a template
        this[key+'UI'] = serviceArray;
    },

    /**
     * Do some processing on the task group / task schema properties and return each property to the callback.
     * @param properties
     * @param cb
     * @private
     */
    _processProperties: function(properties,cb) {
        for (var type in properties) {
            if (!properties.hasOwnProperty(type)) {
                continue;
            }
            var typeGroup = properties[type];
            //we have an array if the typeGroup is "oneOf" so we'll collapse them into a single object before processing
            if (Array.isArray(typeGroup)) {
                var obj={};
                for (var l=0; l<typeGroup.length; l++) {
                    for (var prop in typeGroup[l]) {
                        if (typeGroup[l].hasOwnProperty(prop)) { obj[prop] = typeGroup[l][prop]; }
                    }
                }
                typeGroup = obj;
            }
            //return each property to the callback
            for (var propName in typeGroup) {
                if (!typeGroup.hasOwnProperty(propName)) {
                    continue;
                }
                cb(type,propName,typeGroup[propName]);
            }
        }
    },

    /**
     * Initialize the query editor for building event handlers.
     * @private
     */
    _loadQueryEditor: function() {
        this._queryEditorRef = new Voyent.QueryEditor(this.account,this.realm,'event','events',null,null,{"limit":100,"sort":{"time":-1}},false);
    },

    /**
     * Wrapper for `saveAction()`.
     * @private
     */
    _saveAction: function() {
        this.saveAction();
    },

    /**
     * Wrapper for `updateAction()`.
     * @private
     */
    _updateAction: function() {
        this.updateAction();
    },

    /**
     * Wrapper for `saveAction()`. Prompts for a new id to use for the cloned action.
     * @private
     */
    _cloneAction: function() {
        var actionId = window.prompt("Enter the new action name","");
        if (actionId === null) {
            return;
        }
        this.saveAction(actionId);
    },

    /**
     * Wrapper for `deleteAction()`. Adds a confirm dialog.
     * @private
     */
    _deleteAction: function() {
        if (!this._loadedAction || !this._loadedAction._id) {
            return;
        }

        var confirm = window.confirm("Are you sure you want to delete '" + this._loadedAction._id + "'? This cannot be undone!");
        if (!confirm) {
            return;
        }
        this.deleteAction(this._loadedAction._id);
    },

    /**
     * Update an existing action when the id changes.
     * @private
     */
    _deleteAndSaveAction: function() {
        var _this = this;
        voyent.action.deleteAction({"realm":this.realm,id:this._loadedAction._id}).then(function() {
            _this._deleteHandler(_this._loadedAction._id);
            _this._loadedAction._id = _this._actionId;
            _this.saveAction();
        }).catch(function(error) {
            _this.fire('message-error', "Error in update action: " + error);
            console.error('Error in update action:',error);
        });
    },

    /**
     * Wrapper for `resetEditor()`.
     * @private
     */
    _resetEditor: function() {
        this.resetEditor();
        this.fire('message-info', 'Reset the action editor');
    },

    /**
     * Convert an action from JSON format to a form that the UI can render.
     * @param action
     * @returns {{}}
     */
    _convertActionToUI: function(action) {
        var _this = this;
        //move action id and description to inputs
        this._actionId = action._id;
        this._actionDesc = action.desc && action.desc.trim().length > 0 ? action.desc : '';
        var taskGroups = action.taskGroups;
        for (var i=0; i<taskGroups.length; i++) {
            //add uniqueID for drag/drop functionality
            taskGroups[i].id = this._taskGroupBaseId+i;
            //add schema inside task group for mapping UI values
            taskGroups[i].schema = JSON.parse(JSON.stringify(this._taskGroupSchemasMap[taskGroups[i].type ? taskGroups[i].type : 'parallel-taskgroup'])); //clone object (it is valid JSON so this technique is sufficient)
            taskGroups[i].schema.taskcount = 0;
            processTaskGroups(taskGroups[i]);
            //cleanup type since it's not used in UI
            delete taskGroups[i].type;
            //process tasks
            var tasks = taskGroups[i].tasks;
            for (var j=0; j<tasks.length; j++) {
                //add uniqueID for drag/drop functionality
                tasks[j].id = _this._taskBaseId+j;
                convertTasks(tasks[j],false);
            }
            //process elseTasks (for conditional task groups)
            var elseTasks = taskGroups[i].elseTasks;
            if (elseTasks) {
                for (var k=0; k<elseTasks.length; k++) {
                    //add uniqueID for drag/drop functionality
                    //id is based on entire group not just the elseTasks section
                    //so we account for the number of "if" tasks as well
                    elseTasks[k].id = _this._taskBaseId+(tasks.length+k);
                    convertTasks(elseTasks[k],true);
                }
                //combine the two arrays into one for the template
                taskGroups[i].tasks = tasks.concat(elseTasks);
                delete taskGroups[i].elseTasks;
            }
        }
        return taskGroups;

        function convertTasks(task,isElseTask) {
            //add schema inside task for mapping UI values
            task.schema = JSON.parse(JSON.stringify(_this._taskSchemasMap[task.type])); //clone object (it is valid JSON so this technique is sufficient)
            task.schema.isElseTask = isElseTask;
            taskGroups[i].schema.taskcount++;
            processTasks(task);
        }

        function processTaskGroups(taskGroup) {
            _this._processProperties(taskGroup.schema.properties,function(type,propName,property) {
                //move the task group properties to the value of each property in the schema
                if (typeof taskGroup[property.title] !== 'undefined') {
                    property.value = taskGroup[property.title];
                    delete taskGroup[property.title]; //cleanup property since it's not used in UI
                }
            });
        }
        function processTasks(task) {
            _this._processProperties(task.schema.properties,function(type,propName,property) {
                //move the params values to the value of each property in the schema
                if (task.params && typeof task.params[property.title] !== 'undefined') {
                    property.value = task.params[property.title];
                }
            });
        }
    },

    /**
     * Keeps the select menus in sync with the backing data when loading a saved action.
     * @private
     */
    _updateSelectMenus: function() {
        var _this = this;
        //If a select menu binding is set before the select menu is rendered then the value will not be
        //displayed in the menu. This function works around that by manually updating the select menu.
        for (var i=0; i<_this._taskGroups.length; i++) {
            //loop through all properties to determine if we have any select menus rendered
            for (var j=0; j<_this._taskGroups[i].tasks.length; j++) {
                var propertyGroups = _this._taskGroups[i].tasks[j].schema.properties;
                for (var groupKey in propertyGroups) {
                    if (!propertyGroups.hasOwnProperty(groupKey)) {
                        continue;
                    }
                    var group = propertyGroups[groupKey];
                    if (groupKey !== 'oneOf') {
                        iterateProperties(group,_this._taskGroups[i].name,_this._taskGroups[i].tasks[j].name);
                    }
                    else {
                        for (var k=0; k<group.length; k++) {
                            iterateProperties(group[k],_this._taskGroups[i].name,_this._taskGroups[i].tasks[j].name);
                        }
                    }
                }
            }
        }
        function iterateProperties(group,groupName,taskName) {
            for (var propertyKey in group) {
                if (!group.hasOwnProperty(propertyKey)) {
                    continue;
                }
                var property = group[propertyKey];
                //if we have an enum it means that a select is rendered
                if (property.enum) {
                    var val = property.value;
                    //update the select menu
                    var opt = _this.querySelector('#'+_this._calculateSelectId(groupName,taskName,propertyKey)+' [value="'+val+'"]');
                    if (opt) {
                        opt.selected = true;
                    }
                }
            }
        }
    },

    /**
     * Task group ondragstart event handler.
     * @param e
     * @private
     */
    _startDragGroup: function(e) {
        //Firefox requires using setData in the on-drag handler in order
        //for drag/drop to work so we'll just set some random text
        e.dataTransfer.setData('text', 'foo');
        if (e.model.item) {
            this._lastDragged = e.model.item; //reference task group schema so we can populate the UI on drop
            this._lastDraggedType = 'action/group/new'; //indicate that this item is a new task group
        }
        else {
            this._lastDragged = e.model.group; //reference task group so we can populate the UI on drop
            this._lastDraggedType = 'action/group/existing'; //indicate that this item is an existing task group (already in the action)
        }

        // Add a highlight effect showing all droppable areas for groups
        var acont = this.querySelectorAll('.actionContainer');
        Array.prototype.forEach.call(acont, function(el, i) {
            el.classList.add('highlight');
        });
    },

    /**
     * Action ondragover event handler.
     * @param e
     * @private
     */
    _dragInAndOverAction: function(e) {
        if (this._lastDraggedType === 'action/group/new' ||
            this._lastDraggedType === 'action/group/existing') {
            e.preventDefault(); //only allow task groups to be dragged into the container
        }
    },

    /**
     * Task group ondragover event handler.
     * @param e
     * @private
     */
    _dragInAndOverGroup: function(e) {
        if (this._lastDraggedType === 'action/task/new' ||
            this._lastDraggedType === 'action/task/existing') {
            e.preventDefault(); //only allow tasks to be dragged into the task groups
        }
    },

    /**
     * Action ondrop event handler.
     * @param e
     * @private
     */
    _dropInAction: function(e) {
        // Requirement for drag and drop
        e.preventDefault();

        var _this = this;
        var data;
        var currPos;
        // Only allow task groups to be dropped inside actions
        if (this._lastDraggedType === 'action/group/new') {
            data = JSON.parse(JSON.stringify(this._lastDragged)); //clone schema obj
            data.taskcount = 0; //set default taskcount
        }
        else if (this._lastDraggedType === 'action/group/existing') {
            data = this._lastDragged; //reference existing group
            currPos = this._taskGroups.indexOf(this._lastDragged);
        }
        else {
            e.stopPropagation();
            return;
        }

        // If we have existing action containers (aka task groups) we need to check if the
        //  user tried to drop between them
        // In that case we'll want to insert the dropped task group instead of appending it to the bottom
        var appendBottom = true;
        var newid;
        if (this._taskGroups.length > 0) {
            // First we determine the absolute Y position we dropped at
            // This is a combination of the scrollbar position (via scrollTop) and our event clientY
            //  which shows where in the viewport the mouse was at drop
            // We can add these two together to get an absolute Y of the page
            // Note we also have to get a bit fancy to reliably determine scrollTop
            //  since our component might be in a scrollable container, instead of just a body scrollbar
            var compareTop = this._calculateScrollbarPos(e.target.parentNode);
            //absolute Y position of the drop
            var dropY = e.clientY + compareTop;

            // Next we look at our current task groups
            // For each task group we'll figure out the offsetTop
            // If our dropY is greater than that offsetTop we know we're still below that task group
            // However if our dropY is less we know we're above that task group
            // Using this approach we can figure out where to insert our dropped item
            // We store the task group index we should insert at in the "insertIndex" var
            // If "insertIndex" is undefined (such as when we're dropped above all tasks) then we will append
            var insertIndex;
            var currentTaskGroup;
            for (var i = 0; i < this._taskGroups.length; i++) {
                currentTaskGroup = this.querySelector('#' + this._taskGroups[i].id);
                if (currentTaskGroup) {
                    if (dropY > currentTaskGroup.offsetTop) {
                        insertIndex = this._stripIndex(currentTaskGroup.id);
                        insertIndex++; // Note we increase our insertIndex since we want to be BELOW the current item
                    }
                    else {
                        // There is a chance here we're either at the end of our task group list
                        // Or the dropY was so low because it was inserted ABOVE the task group list
                        // So if we're in this case and still on the first loop we know we're above
                        // Note we use a 30 buffer to match the margins of the acceptable drop area above the task group list
                        if (i === 0 && dropY > (currentTaskGroup.offsetTop - 30)) {
                            insertIndex = 0;
                        }
                        break;
                    }
                }
            }
            if (insertIndex > currPos) {
                insertIndex -= 1;
            }

            // If we have an "insertIndex" it means we figured out where the task group should be inserted
            if (typeof insertIndex !== 'undefined' && insertIndex < this._taskGroups.length) {
                appendBottom = false;
                newid = this._taskGroupBaseId + insertIndex.toString();
                if (this._lastDraggedType === 'action/group/new') {
                    this.splice('_taskGroups', insertIndex, 0, {"id":newid,"name":'',"schema":data,"tasks":[]});
                }
                else {
                    //if the position hasn't changed do nothing
                    if (currPos === insertIndex) {
                        return;
                    }
                    //move from current position to new position
                    this.splice('_taskGroups',currPos,1);
                    this.splice('_taskGroups',insertIndex,0,data);
                }
            }
            // Otherwise if we don't have an "insertIndex" it means we just append to the bottom
            else {
                appendBottom = true;
            }
        }
        // If we reached here and still have "appendBottom" set to true we will add our dropped item to the bottom
        //  of the task group array via push
        if (appendBottom) {
            newid = this._taskGroupBaseId + (this._taskGroups.length).toString();
            if (this._lastDraggedType === 'action/group/new') {
                this.push('_taskGroups', {"id": newid, "name": '', "schema": data, "tasks": []});
            }
            else {
                //remove from current position and push to end of action
                this.splice('_taskGroups',currPos,1);
                this.push('_taskGroups',data);
            }
        }

        setTimeout(function() {
            //keep the task group ids up to date for drag/drop functionality
            _this._updateTaskGroupIds();

            // Finally if we have a valid new ID we'll get that task group
            // item and play a "grow" animation to draw attention to it
            if (newid) {
                _this._doGrowAnimation('#'+newid);
            }
        },0);
    },

    /**
     * Task group ondrop event handler.
     * @param e
     * @private
     */
    _dropInGroup: function(e) {
        // Requirement for drag and drop
        e.preventDefault();

        var _this = this;
        //only allow tasks to be dropped inside task groups
        var data;
        var currPos;
        var previousGroupIndex;
        if (this._lastDraggedType === 'action/task/new') {
            data = JSON.parse(JSON.stringify(this._lastDragged)); //clone schema obj
            //determine if the task was dropped in the conditional task group else area
            data.isElseTask = !!(e.target.className.indexOf('conditional-task-group') > -1 && e.target.className.indexOf('else') > -1);
        }
        else if (this._lastDraggedType === 'action/task/existing') {
            data = this._lastDragged.task; //reference existing task
            //determine if the task was dropped in the conditional task group else area
            data.schema.isElseTask = !!(e.target.className.indexOf('conditional-task-group') > -1 && e.target.className.indexOf('else') > -1);
            previousGroupIndex = this._lastDragged.groupIndex;
            //get the current position of the task in its origin group
            currPos = this._taskGroups[previousGroupIndex].tasks.indexOf(data);
        }
        else {
            e.stopPropagation();
            return;
        }

        // Try to get our task group index from the target ID
        // However there is a chance the user dropped the element on a component inside the container
        // or that the user dropped into a conditional task group drop area
        // In these cases our target ID will be invalid
        // If that happens we will reverse traverse looking for "taskGroupX" ID to strip and use
        var taskGroupIndex = e.target.id.indexOf(this._taskGroupBaseId) === 0 ? this._stripIndex(e.target.id) : null;
        if (typeof taskGroupIndex !== 'number') {
            var currentParent = e.target.parentNode;
            do {
                if (currentParent.id && currentParent.id.indexOf(this._taskGroupBaseId) === 0) {
                    taskGroupIndex = this._stripIndex(currentParent.id);
                    break;
                }
                currentParent = currentParent.parentNode;
            } while(currentParent);
        }

        //Only add if we actually have a proper index figured out +
        if (typeof taskGroupIndex !== 'number' ) {
            return;
        }

        var tasks = this._taskGroups[taskGroupIndex].tasks;
        var appendBottom = true;
        var newid;
        if (tasks.length > 0) {
            //calculate absolute Y position of the drop
            var scrollbarPos = this._calculateScrollbarPos(e.target.parentNode);
            var dropY = e.clientY + scrollbarPos;

            //determine where the Y position is in relative to the other tasks
            var insertIndex;
            var currentTask;
            for (var i = 0; i < tasks.length; i++) {
                currentTask = this.querySelector('#' + this._taskGroupBaseId + taskGroupIndex + ' [data-id="' + tasks[i].id + '"]');
                if (currentTask) {
                    var currentTaskPos = currentTask.getBoundingClientRect().top + scrollbarPos;
                    if (dropY > currentTaskPos) {
                        insertIndex = this._stripIndex(currentTask.getAttribute('data-id'));
                        insertIndex++;
                    }
                    else {
                        if (i === 0) {
                            insertIndex = 0;
                        }
                        break;
                    }
                }
            }
            if ((previousGroupIndex === taskGroupIndex) && (insertIndex > currPos)) {
                insertIndex -= 1;
            }

            //if we have an "insertIndex" it means we figured out where the task group should be inserted
            if (typeof insertIndex !== 'undefined' && insertIndex < tasks.length) {
                appendBottom = false;
                newid = this._taskBaseId + insertIndex.toString();
                if (this._lastDraggedType === 'action/task/new') {
                    this.splice('_taskGroups.' + taskGroupIndex + '.tasks', insertIndex, 0,  {"id": newid,"schema": data});
                }
                else {
                    //always set the isElseTask flag in case it changed
                    this.set('_taskGroups.'+previousGroupIndex+'.tasks.'+currPos+'.schema.isElseTask',data.schema.isElseTask);
                    //if the position hasn't changed then there's nothing to move
                    if (!((previousGroupIndex === taskGroupIndex) &&
                        (currPos === insertIndex))) {
                        //move from current position to new position
                        this.splice('_taskGroups.'+previousGroupIndex+'.tasks',currPos,1);
                        this.splice('_taskGroups.'+taskGroupIndex+'.tasks',insertIndex,0,data);
                    }
                }

            }
            else {
                appendBottom = true;
            }
        }

        if (appendBottom) {
            if (this._lastDraggedType === 'action/task/new') {
                newid = this._taskBaseId + tasks.length.toString();
                this.push('_taskGroups.'+taskGroupIndex+'.tasks', {"id":newid,"schema":data});
            }
            else {
                newid = this._taskBaseId + (this._taskGroups[taskGroupIndex].tasks.length).toString();
                //remove from current position and push to end of task
                this.splice('_taskGroups.'+previousGroupIndex+'.tasks',currPos,1);
                this.push('_taskGroups.'+taskGroupIndex+'.tasks', data);
            }
        }

        setTimeout(function() {
            //keep the task ids up to date for drag/drop functionality
            _this._updateTaskIds();
            //play a "grow" animation to draw attention to the new task
            if (newid) {
                _this._doGrowAnimation('#'+_this._taskGroupBaseId+taskGroupIndex + ' [data-id="' + newid + '"]');
            }
            //set the task count for the group(s)
            if (typeof previousGroupIndex === 'number') {
                _this.set('_taskGroups.'+previousGroupIndex+'.schema.taskcount', _this._taskGroups[previousGroupIndex].tasks.length);
            }
            _this.set('_taskGroups.'+taskGroupIndex+'.schema.taskcount', _this._taskGroups[taskGroupIndex].tasks.length);
        },0);
    },

    /**
     * Return the current vertical position of the scroll bar.
     * @param parent
     * @returns {number}
     * @private
     */
    _calculateScrollbarPos: function(parent) {
        // Normally we can just use the document "scrollTop" (via a few browser compatible ways)
        // But there is a chance our component will be used inside a scrollable container
        // In that case we need to get the scrollTop of any valid parent container
        // So basically if we can't get the scrollTop a normal way, we reverse traverse the
        // parent nodes until we find a valid scrollTop, or hit the top of the document (when parentNode = null)
        var position = (document.documentElement.scrollTop || document.body.scrollTop);
        if (position <= 0) {
            var currentNode = parent;
            while (currentNode !== null) {
                if (currentNode.scrollTop > 0) {
                    position = currentNode.scrollTop;
                    break;
                }
                currentNode = currentNode.parentNode;
            }
        }
        return position;
    },

    /**
     * Delete a task group.
     * @param e
     * @private
     */
    _deleteTaskGroup: function(e) {
        var groupIndex = this._stripIndex(e.model.group.id);
        this.splice('_taskGroups',groupIndex,1);
        //keep the task group ids up to date for drag/drop functionality
        this._updateTaskGroupIds();
    },



    /**
     * Move a task group up.
     * @param e
     * @private
     */
    _moveTaskGroupUp: function(e) {
        var _this = this;
        var taskGroup = e.model.group;
        var currPos = this._taskGroups.indexOf(taskGroup);
        var newPos = currPos-1;
        if (newPos < 0) {
            return;
        }
        //move the group up
        this.splice('_taskGroups',currPos,1);
        this.splice('_taskGroups',newPos,0,taskGroup);
        //keep the taskGroup IDs in sync
        setTimeout(function() {
            _this.set('_taskGroups.'+currPos+'.id',_this._taskGroupBaseId+currPos);
            _this.set('_taskGroups.'+newPos+'.id',_this._taskGroupBaseId+newPos);
        },0);
    },

    /**
     * Move a task group down.
     * @param e
     * @private
     */
    _moveTaskGroupDown: function(e) {
        var _this = this;
        var taskGroup = e.model.group;
        var currPos = this._taskGroups.indexOf(taskGroup);
        var newPos = currPos+1;
        if (newPos == this._taskGroups.length) {
            return;
        }
        //move the group down
        this.splice('_taskGroups',currPos,1);
        this.splice('_taskGroups',newPos,0,taskGroup);
        //keep the taskGroup IDs in sync
        setTimeout(function() {
            _this.set('_taskGroups.'+currPos+'.id',_this._taskGroupBaseId+currPos);
            _this.set('_taskGroups.'+newPos+'.id',_this._taskGroupBaseId+newPos);
        },0);
    },

    /**
     * Clone a task group.
     * @param e
     * @private
     */
    _cloneTaskGroup: function(e) {
        var taskGroup = e.model.group;
        var groupIndex = parseInt(this._stripIndex(taskGroup.id));
        var newIndex = groupIndex+1;

        var clonedTaskGroup = JSON.parse(JSON.stringify(taskGroup));
        clonedTaskGroup.name = clonedTaskGroup.name+'_clone';

        //by default add the cloned task group after the one that was cloned
        this.splice('_taskGroups',newIndex,0,clonedTaskGroup);

        this._updateTaskGroupIds();
        this._doGrowAnimation('#'+this._taskGroupBaseId+newIndex);
    },

    /**
     * Keeps the task group ids in sync.
     * @private
     */
    _updateTaskGroupIds: function() {
        for (var i = 0; i < this._taskGroups.length; i++) {
            this.set('_taskGroups.' + i + '.id', this._taskGroupBaseId+i);
        }
    },

    /**
     * Sorts the list of task items alphabetically.
     * @param a
     * @param b
     * @returns {number}
     * @private
     */
    _sortTaskItems: function(a,b) {
        a = a.title.toLowerCase();
        b = b.title.toLowerCase();
        if (a < b) { return -1; }
        else if (a > b) { return  1; }
        return 0;
    },

    /**
     * Template helper function.
     * @param title
     * @private
     */
    _isConditionalTaskGroup: function(title) {
        return title === 'conditional-taskgroup';
    },

    /**
     * Template helper function
     * Format the passed name and task count with brackets and spacing as necessary
     * Desired return format is (Name, X tasks)
     * This is meant to be used in the title of an action container element
     * @param name
     * @param taskcount
     * @return {string}
     * @private
     */
    _formatContainerName: function(name, taskcount) {
        var toReturn = ' (';

        if (typeof taskcount === 'undefined' || !taskcount) {
            taskcount = 0;
        }

        if (typeof name !== 'undefined' && name) {
            toReturn += name + ', ';
        }

        toReturn += taskcount + ' task';
        // Pluralize if necessary
        if (taskcount !== 1) {
            toReturn += 's';
        }

        toReturn += ')';
        return toReturn;
    },

    //event handler functions

    _getHandlers: function() {
        var _this = this;
        voyent.eventhub.findHandlers({"realm":this.realm}).then(function(handlers) {
            var handlerMap = {};
            if (handlers) {
                handlers.forEach(function (handler) {
                    handlerMap[handler._id] = handler;
                });
            }
            _this._handlers = handlerMap;
        }).catch(function(error) {
            _this.fire('message-error', "Error in getHandlers: " + error);
            console.error('Error in getHandlers:',error);
        });
    },

    _convertUIToHandler: function() {
        return {
            "active":!!this._handlerIsActive,
            "query":this._queryEditorRef.currentquery,
            "actionId":this._actionId,
            "actionParams":{}
        };
    },

    _loadHandler: function(id) {
        id = id + '_handler';
        var handler = this._handlers[id];
        this._handlerIsActive = !!(handler && handler.active ? handler.active : false);
        this._queryEditorRef.setEditorFromMongo({query:handler && handler.query ? handler.query : {}});
    },

    _saveHandler: function(id) {
        var _this = this;
        var handler = this._convertUIToHandler();
        id = id+'_handler';
        var func = 'createHandler';
        if (this._handlers[id]) {
            func = 'updateHandler';
        }
        voyent.eventhub[func]({"realm":this.realm,"id":id,"handler":handler}).then(function(uri) {
        }).catch(function(error) {
            _this.fire('message-error', "Error in saveHandler: " + error);
            console.error('Error in saveHandler:',error);
        });
    },

    _updateHandler: function(id) {
        var _this = this;
        var handler = this._convertUIToHandler();
        id = id+'_handler';
        var func = 'updateHandler';
        if (!this._handlers[id]) {
            func = 'createHandler';
        }
        voyent.eventhub[func]({"realm":this.realm,"id":id,"handler":handler}).then(function(uri) {
        }).catch(function(error) {
            _this.fire('message-error', "Error in updateHandler: " + error);
            console.error('Error in updateHandler:',error);
        });
    },

    _deleteHandler: function(id) {
        var _this = this;
        id = id+'_handler';
        if (!this._handlers[id]) {
            return;
        }
        voyent.eventhub.deleteHandler({"realm":this.realm,"id":id}).then(function() {
        }).catch(function(error) {
            _this.fire('message-error', "Error in deleteHandler: " + error);
            console.error('Error in deleteHandler:',error);
        });
    }
});