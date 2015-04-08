'use strict';

var Q = require('q');
var _ = require('lodash');
var should = require('should');
var memorydb = require('../../lib');
var env = require('../env');
var logger = require('pomelo-logger').getLogger('test', __filename);

describe('autoconnection test', function(){
	beforeEach(env.flushdb);
	after(env.flushdb);

	it('concurrent execute', function(cb){
		var serverProcess = null, autoconn = null;
		var shardId = Object.keys(env.config.shards)[0];

		var user1 = {_id : 1, name : 'rain', level : 0};

		return Q.fcall(function(){
			return env.startServer(shardId);
		})
		.then(function(ret){
			serverProcess = ret;

			return memorydb.autoConnect(env.config.shards[shardId].host, env.config.shards[shardId].port);
		})
		.then(function(ret){
			autoconn = ret;

			return autoconn.execute(function(){
				var User = autoconn.collection('user');
				return User.insert(user1._id, user1);
			});
		})
		.then(function(){
			var count = 8;

			var delay = 0;
			return Q.all(_.range(count).map(function(){
				delay += 10;

				return Q() // jshint ignore:line
				.delay(delay)
				.then(function(){
					// Simulate non-atomic check and update operation
					// each 'thread' add 1 to user1.level
					return autoconn.execute(function(){
						var User = autoconn.collection('user');
						var level = null;

						return Q.fcall(function(){
							return User.findForUpdate(user1._id, 'level');
						})
						.then(function(ret){
							level = ret.level;
						})
						.delay(20)
						.then(function(){
							return User.update(user1._id, {level : level + 1});
						});
					});
				});
			}))
			.then(function(){
				return autoconn.execute(function(){
					var User = autoconn.collection('user');
					return Q.fcall(function(){
						return User.find(user1._id);
					})
					.then(function(ret){
						// level should equal to count
						ret.level.should.eql(count);
						return User.remove(user1._id);
					});
				});
			});
		})
		.then(function(){
			return autoconn.execute(function(){
				return Q.fcall(function(){
					var User = autoconn.collection('user');
					return User.insert(user1._id, user1);
				}).then(function(){
					//Should roll back on exception
					throw new Error('Oops!');
				});
			})
			.catch(function(e){
				e.message.should.eql('Oops!');
			});
		})
		.then(function(){
			return autoconn.execute(function(){
				return Q.fcall(function(){
					var User = autoconn.collection('user');
					return User.find(user1._id);
				})
				.then(function(ret){
					(ret === null).should.eql(true);
				});
			});
		})
		.then(function(){
			return memorydb.close();
		})
		.fin(function(){
			return env.stopServer(serverProcess);
		})
		.nodeify(cb);
	});
});