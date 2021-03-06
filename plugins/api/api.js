/**
 * @file
 * Added API to handle restful communication.
 */

var Q = require('q');

/**
 * Register the plugin with architect.
 */
module.exports = function (options, imports, register) {
  "use strict";

  // Injections objects
  var Channel = imports.channel;
  var Screen = imports.screen;

  var expressJwt = require('express-jwt');

  /**
   * API Object.
   *
   * @constructor
   */
  var API = function () {

    // Injections.
    this.app = imports.app;
    this.logger = imports.logger;
    this.cache = imports.cache;
    this.Q = require('q');

    // Ref the object.
    var self = this;

    /**
    * Helper function to load a channel
    *
    * @param apikey
    *   API-key for the channel to load.
    * @param channelId
    *   The ID of the channel to load.
    *
    * @returns {*}
    */
    function loadChannel(apikey, channelId) {
      var deferred = self.Q.defer();

      var channel = new Channel(apikey, channelId);
      channel.load().then(
        function (channelObj) {
          deferred.resolve({
            "id": channelObj.id,
            "title": channelObj.title,
            "screens": channelObj.screens
          });
        },
        function (error) {
          self.logger.error(error.message);
          deferred.reject(error.message);
        }
      );

      return deferred.promise;
    }

    /**
     * Default get request.
     */
    this.app.get('/api', expressJwt({"secret": options.secret}), function (req, res) {
      res.send('Please see documentation about using this api.');
    });

    /**
    * Get status for all channels.
    */
    this.app.get('/api/status/channels/:apikey', expressJwt({'secret': options.secret}), function (req, res) {
      var apikey = req.params.apikey;
      var data = {
        'apikey': apikey,
        'channels': []
      };

      self.cache.membersOfSet('channel:' + apikey, function (err, channels) {
        if (err) {
          self.logger.error(err.message);
        }
        else {
          // Start promise group to load all channels under the api-key.
          self.Q()
            .then(function () {
              var channelPromises = [];

              // Loop over channels and build promises array.
              for (var i in channels) {
                channelPromises.push(loadChannel(apikey, channels[i]));
              }

              return channelPromises;
            })
            .all()
            .then(
              function (results) {
                data.channels = results;
                res.send(data);
              },
              function (error) {
                res.status(500).send(error.message);
              }
            );
        }
      });
    });

    /**
     * Screen: deactivate.
     */
    this.app.delete('/api/screen/:id/:activationCode', expressJwt({"secret": options.secret}), function (req, res) {
      var profile = req.user;

      if (req.params.hasOwnProperty('id')) {
        // Load screen.
        var screen = new Screen(profile.apikey, req.params.id, req.params.activationCode);
        screen.load().then(
          function (obj) {
            obj.remove().then(
              function () {
                res.sendStatus(200);
              },
              function (error) {
                res.status(500).send(error.message);
              }
            );
          },
          function (error) {
            res.status(500).send(error.message);
          }
        );
      }
      else {
        self.logger.error('API: missing id parameter in update screen.');
        res.status(500).send('Missing parameters in update screen.');
      }
    });

    /**
     * Screen: update.
     */
    this.app.put('/api/screen/:id', expressJwt({"secret": options.secret}), function (req, res) {
      var profile = req.user;

      if (req.params.hasOwnProperty('id') && req.body.hasOwnProperty('title')) {
        // Load screen.
        var screen = new Screen(profile.apikey, req.params.id);
        screen.load().then(
          function (obj) {
            // Set new screen properties.
            obj.title = req.body.title;
            obj.options = req.body.options;
            obj.template = req.body.template;

            // Try to save the screen.
            obj.save().then(
              function () {
                res.sendStatus(200);
              },
              function (error) {
                res.status(500).send(error.message);
              }
            );
          },
          function (error) {
            res.status(500).send(error.message);
          }
        );
      }
      else {
        self.logger.error('API: missing id parameter in update screen.');
        res.send('Missing parameters in update screen.', 500);
      }
    });

    /**
     * Screen: reload.
     */
    this.app.post('/api/screen/:id/reload', expressJwt({"secret": options.secret}), function (req, res) {
      var profile = req.user;

      if (req.params.hasOwnProperty('id')) {
        // Load screen.
        var screen = new Screen(profile.apikey, req.params.id);
        screen.load().then(
          function (obj) {
            if (obj.reload()) {
              // Reload event sent, so sent 200 back.
              res.sendStatus(200);
            }
            else {
              res.status(503).send('Screen connection could not be found.');
            }
          },
          function (error) {
            res.status(500).send(error.message);
          }
        );
      }
      else {
        self.logger.error('API: missing id parameter in reload screen.');
        res.status(500).send('Missing parameters in reload screen.');
      }
    });

    /**
     * Screen: stats.
     */
    this.app.post('/api/screen/:id/stats', function (req, res) {
      var profile = req.user;

      // Get hold of the screen.

      // Get the screen stats.

      res.sendStatus(200);
    });

    /**
     * Channel: remove channel from one screen only.
     *
     * This is done by loading the channel and remove the screen from screens
     * inside the channel. Then save the channel and load the screen and send
     * removeChannel event to the client.
     */
    this.app.delete('/api/channel/:channelId/screen/:screenId', expressJwt({"secret": options.secret}), function (req, res) {
      var profile = req.user;

      if (req.params.hasOwnProperty('channelId') && req.params.hasOwnProperty('screenId')) {

        // Get parameters.
        var screenId = req.params.screenId;
        var channelId = req.params.channelId;

        // Try to load channels.
        var channel = new Channel(profile.apikey, channelId);
        channel.load().then(
          function (channelObj) {
            // Remove screen from channel.
            var index = channelObj.screens.indexOf(screenId);
            delete channelObj.screens[index];

            // Save channel.
            channelObj.save().then(
              function () {
                // Load screen and send remove channel.
                var screen = new Screen(profile.apikey, screenId);
                screen.removeChannel(channelId);

                // Check if channel is used by any one.
                if (!channelObj.screens.length) {
                  // It's not, so delete it.
                  channelObj.remove();
                }

                // Send response back that we have send the event to the client.
                res.sendStatus(200);
              },
              function (error) {
                self.logger.error('API: channel not saved in delete screen.');
                res.status(500).send(error.message);
              }
            );
          },
          function (error) {
            res.status(500).send(error.message);
          }
        );
      }
      else {
        self.logger.error('API: missing id parameter in remove channel.');
        res.status(500).send('Missing parameters in remove channel.');
      }
    });

    /**
     * Channel: remove.
     */
    this.app.delete('/api/channel/:id', expressJwt({"secret": options.secret}), function (req, res) {
      var profile = req.user;

      if (req.params.hasOwnProperty('id')) {
        // Try to load channels.
        var channel = new Channel(profile.apikey, req.params.id);
        channel.load().then(
          function (obj) {
            obj.remove();

            // Channel have been load, as we guess that it's removable.
            res.sendStatus(200);
          },
          function (error) {
            res.status(500).send(error.message);
          }
        );
      }
      else {
        self.logger.error('API: missing id parameter in remove channel.');
        res.status(500).send('Missing parameters in remove channel.');
      }
    });

    /**
     * Channel: create/update better known has push.
     */
    this.app.post('/api/channel/:id', expressJwt({"secret": options.secret}), function (req, res) {
      var profile = req.user;

      // Validate basic data structure.
      if (req.params.hasOwnProperty('id') && req.body.hasOwnProperty('data')) {
        // Try to create channel.
        var channel = new Channel(profile.apikey, req.params.id);
        channel.title = req.body.title;
        channel.data = req.body.data;
        channel.screens = req.body.screens;
        channel.regions = req.body.regions;

        // Save channel and override if one exists.
        channel.save().then(
          function () {
            // Push content.
            channel.push();

            // Log message.
            self.logger.info('API: channel "' + channel.key + '" pushed.');

            // Send response back.
            res.sendStatus(200);
          },
          function (error) {
            res.status(500).send(error.message);
          }
        );
      }
      else {
        self.logger.error('API: missing parameters in channel push.');
        res.status(500).send('Missing parameters in channel push.');
      }
    });
  };

  // Create the API routes using the API object.
  var api = new API();

  // This plugin extends the server plugin and do not provide new services.
  register(null, null);
};
