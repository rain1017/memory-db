'use strict';

var Database = require('./database');
var memdbLogger = require('memdb-logger');
var io = require('socket.io');
var http = require('http');
var P = require('bluebird');

var DEFAULT_PORT = 31017;

exports.start = function(opts){
    var logger = memdbLogger.getLogger('memdb', __filename, 'shard:' + opts.shardId);

    var bindIp = opts.bindIp || '0.0.0.0';
    var port = opts.port || DEFAULT_PORT;

    var httpServer = http.createServer();
    httpServer.listen(port, bindIp);
    var server = io.listen(httpServer);

    var db = new Database(opts);
    db.start().then(function(){
        logger.warn('server started on %s:%s', bindIp, port);
    }, function(err){
        logger.error(err.stack);
        process.exit(1);
    });

    server.on('connection', function(socket){
        var connId = db.connect();
        var remoteAddr = socket.conn.remoteAddress;

        socket.on('req', function(msg){
            logger.debug('[conn:%s] %s => %j', connId, remoteAddr, msg);
            var resp = {seq : msg.seq};

            P.try(function(){
                if(msg.method === 'info'){
                    return {
                        connId : connId
                    };
                }
                else{
                    return db.execute(connId, msg.method, msg.args);
                }
            })
            .then(function(ret){
                resp.err = null;
                resp.data = ret;
            }, function(err){
                resp.err = err.stack;
                resp.data = null;
            })
            .then(function(){
                socket.emit('resp', resp);
                logger.debug('[conn:%s] %s <= %j', connId, remoteAddr, resp);
            })
            .catch(function(e){
                logger.error(e.stack);
            });
        });

        socket.on('disconnect', function(){
            P.try(function(){
                return db.disconnect(connId);
            })
            .then(function(){
                logger.info('[conn:%s] %s disconnected', connId, remoteAddr);
            })
            .catch(function(e){
                logger.error(e.stack);
            });
        });

        logger.info('[conn:%s] %s connected', connId, remoteAddr);
    });

    var _isShutingDown = false;
    var shutdown = function(){
        logger.warn('receive shutdown signal');

        if(_isShutingDown){
            return;
        }
        _isShutingDown = true;

        return P.try(function(){
            server.close();

            return db.stop();
        })
        .catch(function(e){
            logger.error(e.stack);
        })
        .finally(function(){
            logger.warn('server closed');
            setTimeout(function(){
                process.exit(0);
            }, 200);
        });
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

    process.on('uncaughtException', function(err) {
        logger.error('Uncaught exception: %s', err.stack);
    });
};
