/**
 * @file
 * Handle initial socket communication with the client (frontend).
 */

/**
 * Register the plugin with architect.
 */
module.exports = function (options, imports, register) {
  "use strict";

  // Load promise library.
  var Q = require('q');

  // Injections.
  var socketIO = imports.socket;
  var Screen = imports.screen;
  var logger = imports.logger;
  var cache = imports.cache;
  var Channel = imports.channel;

  /**
   * Handle socket connection event from a client.
   */
  socketIO.on('connection', function (socket) {
    /**
     * Ready event.
     */
    socket.on('ready', function () {
      // Get the JWT decoded token.
      var profile = socket.client.request.decoded_token;

      // Create key to store socket under.
      var key = profile.apikey + ':' + profile.screenID;

      // Get last knonw socket for this screen.
      var cachedSocket = socketIO.get(profile.apikey, profile.screenID);

      // Check if the registred screen is different that the one in the cache.
      if (cachedSocket && cachedSocket.handshake.query.uuid !== socket.handshake.query.uuid) {
        // It is a nother screen to don't connect, kick it.
        logger.info('Screen tried to re-connect with used activation code: ' + profile.activationCode + ', apikey: ' + profile.apikey + ', screen id: ' + profile.screenID)
        socket.emit('booted', {"statusCode": 404});
        socket.disconnect();
      }
      else {
        // No conflict in socket usage, so lets carry on.
        registerSocket(socket, key);
        handleSocketCommunication(socket, profile, key);

        // Update the activation cache with the code used. This is to rebuild
        // the cache after an cache clear.
        imports.cache.hashSet('activation:' + profile.apikey, profile.activationCode, profile.screenID, function(error, res) {
          if (error) {
            imports.logger.error('Auth: Activation code hash could not be updated.');
          }
        });
      }
    });
  });

  /**
   * Handle socket communication after socket connection have been approved.
   */
  function handleSocketCommunication(socket, profile, key) {
    // Try to get the screen.
    var screen = new Screen(profile.apikey, profile.screenID, profile.activationCode);
    screen.load().then(
      function (screenObj) {
        screenObj.title = profile.screenTitle;
        screenObj.heartbeat = Math.round((new Date()).getTime() / 1000);
        screenObj.save().then(
          function () {
            // Send a 200 ready code back to the client with information about
            // template and options.
            socket.emit('ready', {
              "statusCode": 200,
              "screen": {
                "id": screenObj.id,
                "title": screenObj.title,
                "options": screenObj.options,
                "template": screenObj.template
              }
            });

            // Load all channels with the clients api key to see if they have
            // content for the channel.
            cache.membersOfSet('channel:' + profile.apikey, function(err, channels) {
              if (err) {
                socket.emit('error', {
                  "statusCode": 500,
                  "message": err.message
                });
              }
              else {
                // Loop over channel ID's and load channels.
                for (var i in channels) {
                  var channel = new Channel(profile.apikey, channels[i]);

                  // Load channel to get screens.
                  channel.load().then(
                    function (channelObj) {
                      // Check if channel has the screen.
                      if (channelObj.hasScreen(profile.screenID)) {
                        // Ask screen to push content.
                        var regions = [];
                        for (var j = 0; j < channelObj.regions.length; j++) {
                          if (channelObj.regions[j].screen === screenObj.id) {
                            regions.push(channelObj.regions[j].region);
                          }
                        }

                        // Send channel content to the current screen.
                        screenObj.push({
                          "regions": regions,
                          "data": channelObj.data
                        });
                      }
                    },
                    function (error) {
                      socket.emit('error', {
                        "statusCode": 500,
                        "message": error.message
                      });
                    }
                  );
                }
              }
            });
          },
          function (error) {
            // Send error to client.
            socket.emit('error', {
              "statusCode": 500,
              "message": error.message
            });
          }
        );
      },
      function (error) {
        // Log error.
        logger.error('Client: ' + error.message);

        // Send error to client.
        socket.emit('error', {
          "statusCode": 500,
          "message": error.message
        });
      }
    );

    /**
    * Logout event from the screen which requires the screen to be removed.
    */
    socket.on('logout', function () {
      // Try to get the screen.
      var screen = new Screen(profile.apikey, profile.screenID, profile.activationCode);
      screen.load().then(
        function (screenObj) {
          screenObj.remove().then(
            function () {
              logger.info('Client: Logged out ' + profile.apikey + ':' + profile.screenID);
            },
            function (error) {
              logger.error('Client: ' + error.message);
            }
          );
        },
        function (error) {
          logger.error('Client: ' + error.message);
        }
      );
    });

    // Listen to disconnect and remove socket from store.
    socket.on('disconnect', function() {
      socketIO.remove(key);

      // Log dis-connection event.
      logger.socket("Disconnected " + profile.apikey + ' <-:-> ' + profile.screenID);
    });

    /**
    * Heartbeat event.
    *
    * Handle heartbeat event used to check that the screen are alive.
    */
    socket.conn.on('heartbeat', function heartbeat() {
      var screen = new Screen(profile.apikey, profile.screenID);
      screen.load().then(
        function (screenObj) {
          screenObj.heartbeat = Math.round((new Date()).getTime() / 1000);
          screenObj.save();
        },
        function (error) {
          logger.info('Client: unable to load screen to set heartbeat.');
        }
      );
    });
  }

  /**
   * Register information about the socket and add event listeners.
   */
  function registerSocket(socket, key) {
    // Add socket to store.
    socketIO.add(key, socket);
  }

  // Register the plugin with the system.
  register(null, null);
};
