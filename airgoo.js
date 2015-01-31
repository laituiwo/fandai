var defines = require('./defines'),
    CONF = defines.config(),
    url = require('url'),
    util = require('util'),
    zlib = require('zlib'),
    client = require(CONF.backend_https ? 'https' : 'http');

var RULES = defines.rules;
var TARGET = CONF.target;
var re_domain = /domain=([-.\w]+)/;
var re_path = /path=([^;]+)/;
var re_text = /text|java|json/;
var re_dyna = /html|json/;
var excludedHeaders = defines.excludedHeaders;
var preferLang = CONF.prefer_lang + ';q=0.9,en;q=0.1';
client.globalAgent.maxSockets = 255;


/**
 * 复制http header
 * r1阶段它域的cookie跳过
 * r3阶段的替换为本域
 * @param src
 * @param dest
 * @param domain
 * @param ext r1 is boolean, r3 is string
 * @returns {*|{}}
 */
function copyHeaders(src, dest, domain, ext) {
    dest = dest || {};
    domain = defines.getHostName(domain);
    ext = defines.getHostName(ext);
    var key, val;
    for (key in src) {
        if (src.hasOwnProperty(key) && !excludedHeaders[key] && !defines.startsWith(key, 'x-')) { // 防止x-forwarded-*
            val = src[key];
            if (key === 'set-cookie') { // 处理domain
                if (!domain)
                    continue;
                val = util.isArray(val) ? val : [val];
                for (var i = 0, len = val.length; i < len; i++) {
                    val[i] = val[i].replace(re_domain, 'domain=.' + domain);
                    if (defines.startsWith(val[i], 'PREF')) {
                        val[i] = val[i].replace(/LD=[-\w]+/, 'LD=' + CONF.prefer_lang);
                    }
                    if (ext) {
                        val[i] = val[i].replace(re_path, 'path=/!' + ext + '$1');
                    }
                }
            }
            if (key === 'cookie' && !defines.endsWith(domain, TARGET.domain)) {
                continue;
            }
            dest[key] = val;
        }
    }
    return dest;
}


/**
 * 根据r1生成r2请求
 * 如果它域被拒绝则抛异常
 * @param req
 * @returns {*}
 */
function buildRequest() {
    var req = this.r1,
        options = {
            hostname: TARGET.fullName,
            path: req.url,
            method: req.method
        };
    if (defines.startsWith(req.url, '/!')) {
        var pos = req.url.charAt(2) == '/' ? 4 : 2; // for double //
        var part = url.parse('//' + req.url.substr(pos), null, true);
        if (!part.hostname || !defines.allow(part.hostname)) {
            throw new Error('Denied');
        }
        options.hostname = part.hostname;
        options.path = part.path || '';
        options.ext = true;
    } else if (isCookieRequired(req)) {
        log(this.r1, 'Client cookie is required');
        options.path = '/ncr';
    }
    //options.path = (options.path.indexOf('?') > 0 ? '&' : '?') + 'nord=1';
    options.headers = copyHeaders(req.headers, {
        'Connection': 'keep-alive',
        'Accept-Language': preferLang,
        'Accept-Encoding': 'gzip'
    }, options.hostname, options.ext);

    var sorryRedirect = (options.headers['cookie'] || '').match(/_abused=([-.\w]+)/);
    if (util.isArray(sorryRedirect)) {
        this._abused = options.hostname = sorryRedirect[1];
        this._abusing = true;
    }
    return options;
}

function isCookieRequired(req) {
    var pos = req.url.search(/.[/?#]/);
    if (req.url === '/' || defines.cookieRequired[pos > 0 ? req.url.substr(0, pos + 1) : req.url]) {
        var cookie = JSON.stringify(req.headers['cookie']);
        return !cookie || !/PREF=.*CR=2/.test(cookie);
    }
    return false;
}

function cookRedirect(oldUrl) {
    var newUrl = url.parse(oldUrl);
    if (/\.google.*\bIndexRedirect/.test(oldUrl)) {
        log(this.r1,'Google abuse inspection was detected.')
        this._abused = newUrl.hostname;
        this._abusedNew = true;
    } else if (newUrl.hostname && newUrl.hostname !== TARGET.fullName) {
        newUrl.pathname = '/!' + newUrl.hostname + newUrl.pathname;
    }
    newUrl.host = this.origHost;
    newUrl.protocol = this.origProto + ':';
    return url.format(newUrl);
}


/**
 * 当trust_proxy后，用forwarded-for作为client地址
 * @param req,fmt,args...
 * @param fmt,args...
 * @param msg...
 */
function log() {
    if (!CONF.logging || arguments.length < 1)
        return;

    var req, address, args = Array.prototype.slice.call(arguments);
    if (args[0].headers) { // is request obj.
        req = args[0];
    } else {
        args.unshift(0);
    }
    if (req) {
        address = (CONF.trust_proxy && req.headers['x-forwarded-for']) || req.connection.remoteAddress;
        var comma = (address || '').indexOf(',');
        if (comma > 0) {
            address = address.substr(0, comma);
        }
    }
    // 0=fmt,1=ip
    args[0] = '%t - %s - ' + args[1];
    args[1] = address || '*';
    // direct write
    process.stdout.write(defines.format.apply(defines, args) + '\n');
}

/**
 * 请求会话
 */
var AirGooSession = function(r1, r4, args) {
    this.r1 = r1;
    this.path = r1.url;
    this.r4 = r4;
    defines.apply(this, args);

    var abort = function(code, msg, logs) {
        r4.writeHead(code);
        r4.end(msg);
        if (util.isArray(logs)) {
            logs.unshift(r1);
            log.apply(null, logs);
        } else {
            log(r1, logs + msg);
        }
    };

    try {
        if (r1.method === 'POST') {
            var len = r1.headers['content-length'];
            this.bodyLength = parseInt(len);
            if (len > 1e7) {
                throw new Error('entity too large');
            }
        }
        this.r2_opts = buildRequest.call(this);
    } catch (e) {
        // 它域被拒绝
        this.deny = true;
        return abort(403, e.message || String(e), ['Denied %s', this.path]);
    }

    /**
     * 检查响应头，检查设置zip,cache等，为r4准备头
     * @param r3 {response} Google response
     */
    this.prepare = function(r3) {
        this.r3_content_length = parseInt(r3.headers['content-length'] || -1);
        if (CONF.max_transmit_size > 0 && this.r3_content_length > CONF.max_transmit_size) {
            throw new Error('Size exceeds');
        }
        this.r3_statusCode = r3.statusCode;
        this.r3_contentType = r3.headers['content-type'];
        this.r3_contentEncoding = r3.headers['content-encoding'];
        this.textType = re_text.test(this.r3_contentType);
        this.cacheable = !re_dyna.test(this.r3_contentType);
        // 某些ajax
        if (r3.headers['content-disposition'])
            this.cacheable = false;
        this.r4_headers = copyHeaders(r3.headers, {}, this.origHost,
            this.r2_opts.ext ? this.r2_opts.hostname : false);

        log(this.r1, '[%s] - %s %d', r3.statusCode, this.path, this.r3_content_length);
        // all Redirect
        var _location = r3.headers['location'];
        if (r3.statusCode / 10 >> 0 === 30 && _location) {
            log(this.r1, 'Cooking redirect of ' + _location);
            this.r4_headers['location'] = cookRedirect.call(this, _location);
        }
    };


    /**
     *
     * @param len {int}
     * @param zipped {boolean}
     */
    this.sendHeader = function(len, zipped) {
        if (this.cacheable && CONF.force_cached_time > 0) {
            var cacheControl = this.r4_headers['cache-control'];
            // middleware cache need public.
            if (!cacheControl || !defines.startsWith(cacheControl, 'public'))
                this.r4_headers['cache-control'] = 'public';
            var expires = this.r4_headers['expires'];
            if (expires) {
                var expiresDate = new Date(expires);
                var now = new Date().getTime();
                // 已经过期或者马上过期的要加时
                if (expiresDate.getTime() <= now + 1000) {
                    expiresDate.setTime(now + CONF.force_cached_time * 1000);
                    this.r4_headers['expires'] = expiresDate.toGMTString();
                }
                // http://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_cache_valid
                // in seconds since Epoch.
                this.r4_headers['X-Accel-Expires'] = '@' + ((expiresDate.getTime() / 1000) >> 0);
            } else {
                // in seconds.
                this.r4_headers['X-Accel-Expires'] = String(CONF.force_cached_time);
            }
        }
        if (zipped)
            this.r4_headers['content-encoding'] = 'gzip';
        if (len >= 0)
            this.r4_headers['content-length'] = len;
        if (CONF.server_header)
            this.r4_headers['server'] = CONF.server_header;
        if (this._abused) {
            var setCookies = this.r4_headers['set-cookie'] || [];
            if (defines.isString(setCookies)) {
                setCookies = [setCookies];
            }
            var _exempted = /=GOOGLE_ABUSE_EXEMPTION/.test(this.r4_headers['location']);
            if (this._abusing && _exempted) {
                setCookies.push('_abused=; expires=Mon, 01-Jan-1990 00:00:00 GMT');
            } else if (this._abusedNew) {
                setCookies.push(defines.format('_abused=%s; expires=%s', this._abused, new Date(Date.now() + 3e6).toGMTString()));
            }
            this.r4_headers['set-cookie'] = setCookies;
        }
        this.r4.writeHead(this.r3_statusCode, this.r4_headers);
    };


    /**
     * 用Rules对三种文本内容处理，非文本则跳过
     * @param content Buffer
     * @returns {*}
     */
    this.processContent = function(content) {
        var rules;
        if (defines.contains(this.r3_contentType, 'html')) {
            rules = RULES.html;
        } else if (defines.contains(this.r3_contentType, 'json')) {
            rules = RULES.json;
        } else if (defines.contains(this.r3_contentType, 'javas')) {
            rules = RULES.js;
        }
        if (rules && content) {
            var str = content.toString(),
                insertHeaders = [],
                replacement;
            for (var rule, i = 0, len = rules.length; i < len; i++) {
                rule = rules[i];
                if (rule.pathRegex && !rule.pathRegex.test(this.path)) {
                    continue;
                }
                replacement = rule.replacement;
                if (replacement.indexOf('{') >= 0) {
                    var self = this;
                    replacement = replacement.replace(/\{(\w+)}/g, function(ma, g1){
                        return self[g1] || ma;
                    });
                }
                if (rule.insertHeader) {
                    insertHeaders.push(rule.insertHeader);
                }
                str = str.replace(rule.pattern, replacement);
            }
            if (insertHeaders.length) {
                return new Buffer(insertHeaders.join('') + str);
            } else {
                return new Buffer(str);;
            }
        }
        return content;
    };

    /**
     * if zipped response then call by unzip
     * @param err
     * @param body {Buffer}
     */
    this.send = function(err, body) {
        if (body.length) {
            body = this.processContent(body);
        }
        // 有数据,且允许r4压缩
        if (CONF.gzip_r4 && body.length > 0) {
            zlib.gzip(body, function(err, buf) {
                if (err) {
                    log(util.inspect(err));
                    this.cacheable = false;
                    this.sendHeader(buf.length);
                } else {
                    this.sendHeader(buf.length, true);
                }
                // zipped stream
                this.r4.end(buf);
            }.bind(this));
        } else {
            // Non-zipped
            this.sendHeader(body.length);
            this.r4.end(body);
        }
    };

    this.doProxy = function(bodyData) {
        var that = this;
        var req = client.request(this.r2_opts, function(r3) {
            try {
                that.prepare(r3);
            } catch (e) { // size
                this.abort();
                that.deny = true;
                return abort(403, e.message || String(e), 'Denied : ' + that.path);
            }
            var zipped = that.r3_contentEncoding === 'gzip';
            if (that.textType) {
                var definite = that.r3_content_length > 0,
                    offset = 0;
                var body = new Buffer(definite ? that.r3_content_length : 0);
                r3.on('end', function() {
                    if (zipped) {
                        zlib.gunzip(body, that.send.bind(that));
                    } else {
                        that.send(null, body);
                    }
                }).on('data', function(data) {
                    if (definite) {
                        data.copy(body, offset);
                        offset += data.length;
                    } else {
                        body = Buffer.concat([body, data]);
                    }
                });
            } else {
                // 非文本直接通过
                that.sendHeader(that.r3_content_length, zipped);
                r3.pipe(that.r4);
            }
        }).on('error', function(e) {
            // Error in r3.
            abort(500, e.message || String(e));
        }).end(bodyData);
    };
};

var AirGooServer = function() {

    var self = this;

    this.requestHandler = function(r1, r4) {
        if (self.preHandler(r1, r4)) {
            return;
        }
        var origHost = r1.headers['x-forwarded-host'];
        var origProto = r1.headers['x-forwarded-proto'];
        if (!origHost) {
            if (!CONF.orig_host) {
                log(r1, 'WARN - Not found the `x-forwarded-host` header from request and config.');
                origHost = r1.headers['host'];
            } else {
                origHost = CONF.orig_host;
            }
        }
        if (!origProto) {
            if (!CONF.orig_proto) {
                log(r1, 'WARN - Not found the `x-forwarded-proto` header from request and config.');
                origProto = 'http';
            } else {
                origProto = CONF.orig_proto;
            }
        }
        if (CONF.force_https && origProto !== 'https') {
            r4.writeHead(301, {
                'Location': 'https://' + origHost
            });
            r4.end();
            log(r1, 'redirect to https from %s%s', origHost, r1.url);
            return;
        }
        var session = new AirGooSession(r1, r4, {
            origHost: origHost,
            origProto: origProto
        });
        if (session.deny) {
            return;
        }
        if (session.bodyLength) {
            var data = new Buffer(session.bodyLength),
                offset = 0;
            r1.on('data', function(chunk) {
                chunk.copy(data, offset);
                offset += chunk.length;
            }).on('end', function() {
                console.log('post: ' + data);
                session.doProxy(data);
            });
        } else {
            session.doProxy();
        }
    };

    this.preHandler = function(r1, r4) {
        if (/^\/(\w+_204|imghover)/.test(r1.url)) {
            r4.writeHead(204, {
                'content-type': 'text/html; charset=UTF-8'
            });
            r4.end();
            return true;
        }
        if (defines.startsWith(r1.url, '/robots.txt')) {
            r4.writeHead(200, {
                'content-type': 'text/plain'
            });
            r4.end('User-agent: *\nDisallow: / ');
            return true;
        }
        return false;
    };

    this.terminator = function terminator(sig) {
        if (typeof sig === "string") {
            log('\nReceived %s - terminating ...', sig);
            process.exit(1);
        }
        log('AirGoo-Server stopped.');
    };


    /**
     *  Setup termination handlers (for exit and a list of signals).
     */
    this.setupTerminationHandlers = function setupTerminationHandlers() {
        //  Process on exit and signals.
        process.on('exit', self.terminator.bind(self));

        ['SIGHUP', 'SIGINT', 'SIGQUIT', 'SIGILL', 'SIGTRAP', 'SIGABRT',
            'SIGBUS', 'SIGFPE', 'SIGUSR1', 'SIGSEGV', /*'SIGUSR2',*/ 'SIGTERM' // todo
        ].forEach(function(element, index, array) {
            process.on(element, function() {
                self.terminator(element);
            });
        });
    };

    this.initialize = function(options) {
        self.options = options;
        self.setupTerminationHandlers();
        return self;
    };

    this.start = function() {
        if (!self.options)
            throw new Error('Not initialized');

        require('http').createServer(self.requestHandler)
            .on('listening', function() {
                log('AirGoo-Server v%s started on %s', defines.version, this._connectionKey);
            })
            .listen(self.options.port, self.options.addr);
    }

};

module.exports = AirGooServer;