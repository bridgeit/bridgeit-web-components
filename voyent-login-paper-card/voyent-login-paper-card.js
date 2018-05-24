(function() {
    'use strict';

    Polymer({
        is: 'voyent-login-paper-card',

        behaviors: [
            Polymer.IronFormElementBehavior,
            Polymer.IronValidatableBehavior
        ],

        properties: {
            /**
             * Header text to title our login card
             */
            heading: {
                notify: true,
                type: String
            },
            /**
             * Username input
             */
            username: {
                notify: true,
                type: String,
                value: function(){ return voyent.auth.getLastKnownUsername();}
            },
            /**
             * Password input
             */
            password: {
                notify: true,
                type: String
            },
            /**
             * Toggle whether this component is visible
             */
            visible: {
                notify: true,
                type: Boolean
            },
            /**
             * Error string custom to this component that displays below our login card
             */
            error: {
                notify: true,
                type: String
            },
            /**
             * Authentication provider to use in conjunction with our login details
             */
            authProvider: {
                notify: true,
                type: String
            },
            /**
             * Text label for the submit button
             */
            submitLabel: {
                notify: true,
                type: String
            },
            /**
             * Text label for the cancel button
             */
            cancelLabel: {
                notify: true,
                type: String
            },
            /**
             * Determine if we should attempt to login as an admin
             */
            loginAsAdmin: {
                notify: true,
                type: Boolean
            },
            /**
             * Image to use in the header of our login card
             */
            headerImage: {
                notify: true,
                type: String
            },
            /**
             * Determine if we should show a realm input field
             */
            showrealminput: {
                notify: true,
                type: Boolean
            },
            /**
             * Whether the component should search for the realm details, only relevant if showrealminput is false.
             */
            searchforrealm: {
                notify: true,
                type: Boolean
            },
            /**
             * Determine if we should show an account input field
             */
            showaccountinput: {
                notify: true,
                type: Boolean
            },
            /**
             * Determine if we should show a host input field
             */
            showhostinput: {
                notify: true,
                type: Boolean
            },
            disablehostinput: {
                notify: true,
                type: Boolean
            },
            /**
             * Label for the Realm field
             * Also used automatically as part of the placeholder
             */
            realminputlabel: {
                type: String,
                notify: true,
                value: 'Realm'
            },
            /**
             * Label for the Account field
             * Also used automatically as part of the placeholder
             */
            accountinputlabel: {
                type: String,
                notify: true,
                value: 'Account'
            },
            /**
             * Show a button that allows the details panel (realm, account, host) to be hidden
             * This ties to an iron-collapse wrapper
             */
            hideallowed: {
                notify: true,
                type: Boolean,
                value: false
            },
            /**
             * Toggle the initial state of the details panel (realm, account, host)
             */
            hideclosed: {
                notify: true,
                type: Boolean,
                value: false
            },
            /**
             * Realm used for services
             */
            realm: {
                notify: true,
                type: String,
                value: function(){ return voyent.auth.getLastKnownRealm(); }
            },
            /**
             * Account used for services
             */
            account: {
                notify: true,
                type: String,
                value: function(){ return voyent.auth.getLastKnownAccount(); }
            },
            /**
             * Host used for services
             */
            host: {
                notify: true,
                type: String,
                value: 'dev.voyent.cloud'
            },
            hidden: {
                notify: true,
                type: Boolean,
                value: false
            },
        },
        
        attached: function() {
            if (document.getElementById("username")) {
                document.getElementById("username").focus();
            }
            this._regionResults = [];
        },

        /**
         * Fired when the login card is submitted
         * Interact with the authentication provider using our various field data to determine if the login was valid
         *
         * @param e
         */
        handleLogin: function(e){
            var _this = this;
            e.preventDefault();
            var authProvider = document.querySelector('#' + this.authProvider) ||
                               Polymer.dom(this).parentNode.querySelector('#' + this.authProvider);
            if( !authProvider ){
                console.error('voyent-login-paper-card could not find auth-provider: ' + this.authProvider);
                return;
            }
            this.fire('loading-on');
            // Pre-process our account to a form understandable by the login
            var safeAccount = this._getSafeDatabaseName(_this.account);
            if(_this.showaccountinput) {
                authProvider.setAttribute("account", safeAccount);
            }
            if(_this.showhostinput) {
                authProvider.setAttribute("host",_this.host)
            }
            if(_this.showrealminput) {
                authProvider.setAttribute("realm",_this.realm);
            }
            else if (_this.searchforrealm) {
                authProvider.set('error',null);
                _this._publicLookupUser(_this.username,safeAccount).then(function(res) {
                    if (!res.matches.length) {
                        _this.fire('loading-off');
                        authProvider.set('error','Unauthorized');
                    }
                    else if (res.matches.length === 1) {
                        _this.set('realm',res.matches[0].realm);
                        authProvider.setAttribute("realm",_this.realm);
                        _this._login();
                    }
                    else {
                        _this.set('_regionResults',res.matches);
                        _this.fire('loading-off');
                    }
                }).catch(function() {
                    _this.fire('loading-off');
                });
                return;
            }
            _this._login();
        },

        _login: function() {
            var _this = this;
            authProvider.login(_this.username, _this.password, _this.loginAsAdmin).then(function() {
                //clear password
                _this.password = '';
                _this.fire('loading-off');
            }).catch(function(){
                _this.fire('loading-off');
            });
        },
        
        _getSafeDatabaseName: function(accountName) {
            if (accountName && accountName.trim().length > 0) {
                return accountName.split(' ').join('_').replace(/[\\\/\.\"]/g, '').substring(0, 63).toLowerCase();
            }
            return accountName;
        },

        /**
         * Reset the password
         */
        _clearPassword: function(){
            this.password = '';
        },

        /**
         * Reset the username
         */
        _clearUsername: function(){
            this.username = '';
        },

        /**
         * Reset the realm
         */
        _clearRealm: function(){
            this.realm = '';
        },

        /**
         * Reset the account
         */
        _clearAccount: function(){
            this.account = '';
        },

        /**
         * Reset the account
         */
        _clearHost: function(){
            this.host = '';
        },

        /**
         * Overidden from Polymer.IronValidatableBehavior
         * Will set the `invalid` attribute automatically, which should be used for styling.
         */
        _getValidity: function() {
            return !!this.password && !!this.username;
        },

        /**
         * Fired when cancel is clicked, which will reset the username & password inputs
         */
        cancel: function(){
            this._clearUsername();
            this._clearPassword();
            this._regionResults = [];
        },

        _cancelRegionResults: function() {
            this._clearPassword();
            this.set('_regionResults',[]);
        },

        /**
         * Lookup a user by username, in any account/realm
         */
        _publicLookupUser: function(username, account) {
            var sourceUrl = this._getHttpProtocol() + this.host + "/vs/vras/realms/public/users/?name=" + username;
            if (account) {
                sourceUrl += '&account=' + account;
            }
            return new Promise(
                function(resolve, reject) {
                    // Try to retrieve the desired JSON
                    voyent.$.get(sourceUrl).then(function(res) {
                        if (res) {
                            try {
                                resolve(JSON.parse(res));
                            }
                            catch(e) {
                                resolve(res);
                            }
                        }
                    }).catch(function(error) {
                        reject(error);
                    });
                }
            );
        },

        _getHttpProtocol: function() {
            return ('https:' == document.location.protocol ? 'https://' : 'http://');
        },

        _arrayLength: function(toShow) {
            return toShow ? toShow.length : 0;
        },

        /**
         * Easy to read region match results string
         * Ideally "display name - description"
         * Note that description will be temporarily cropped to 100 characters for preview readability
         */
        _friendlyResults: function(result) {
            var toReturn = "Unknown";
            if (result) {
                if (result.displayName) {
                    toReturn = result.displayName;
                }
                else if (result.realm) {
                    toReturn = result.realm;
                }

                if (result.description) {
                    // Crop the description if it's too long
                    if (result.description.length > 100) {
                        toReturn += " - " + result.description.substring(0, 100) + "...";
                    }
                    else {
                        toReturn += " - " + result.description;
                    }
                }
            }
            return toReturn;
        },

        _selectRegion: function(e) {
            this.set('realm',e.model.item.realm);
            authProvider.setAttribute("realm",this.realm);
            this._login();
        }
    });
})();
