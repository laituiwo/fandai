var defines = require('./defines'),
    url = require('url'),
    util = require('util'),
    zlib = require('zlib'),
    client = require(defines.config.backend_https ? 'https' : 'http');

var CONF = defines.config();
var RULES = defines.rules;
var re_domain = /domain=[.\w]+/;
var re_path = /path=([^;]+)/;
var re_text = /(text|java|json)/;
var re_dyna = /(html|json)/;
var excludedHeaders = defines.excludedHeaders;
var preferLang = CONF.prefer_lang + ';q=0.8,en;q=0.5';
client.globalAgent.maxSockets = 255;


/**
 * 复制http header
 * r1阶段它域的cookie跳过
 * r3阶段的替换为本域
 * @param src
 * @param dest
 * @param domain
 * @param ext
 * @returns {*|{}}
 */
function copyHeaders(src, dest, domain, ext) {
    dest = dest || {};
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
                    if (ext) {
                        val[i] = val[i].replace(re_path, 'path=/!' + ext + '$1');
                    }
                }
            }
            if (key === 'cookie' && !defines.endsWith(domain, '.google.com'))
                continue;
            dest[key] = val;
        }
    }
    return dest;
}


/**
 * 用Rules对三种文本内容处理，非文本则跳过
 * @param path
 * @param contentType
 * @param content
 * @returns {*}
 */
function processContent(path, contentType, content) {
    var rules;
    if (defines.contains(contentType, 'html')) {
        rules = RULES.html;
    } else if (defines.contains(contentType, 'json')) {
        rules = RULES.json;
    } else if (defines.contains(contentType, 'javas')) {
        rules = RULES.js;
    }
    if (rules && content) {
        var str = content.toString();
        for (var rule, i = 0, len = rules.length; i < len; i++) {
            rule = rules[i];
            if (rule.pathRegex && !rule.pathRegex.test(path))
                continue;
            str = str.replace(rule.pattern, rule.replacement);
        }
        return new Buffer(str);
    }
    return content;
}


/**
 * 根据r1生成r2请求
 * 如果它域被拒绝则抛异常
 * @param req
 * @returns {*}
 */
function buildRequest(req) {
    var path = req.url + (req.url.indexOf('?') < 0 ? '?' : '&') + 'nord=1',
        options = {
            hostname: 'www.google.com',
            path: path
        };
    if (defines.startsWith(path, '/!')) {
        var part = url.parse('//' + path.substr(2), null, true);
        if (!part.hostname || !defines.allow(part.hostname))
            throw new Error('Denied');
        options.hostname = part.hostname;
        options.path = part.path || '';
        options.ext = true;
    }
    options.headers = copyHeaders(req.headers, {
        'Connection': 'keep-alive',
        'Accept-Language': preferLang,
        'Accept-Encoding': 'gzip'
    }, options.hostname, options.ext);
    return options;
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
        var comma = address.indexOf(',');
        if (comma > 0)
            address = address.substr(0, comma);
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
var AirGooSession = function (r1, r4) {
    this.r1 = r1;
    this.path = r1.url;
    this.r4 = r4;

    try {
        this.r2_opts = buildRequest(r1);
    } catch (e) {
        // 它域被拒绝
        this.deny = true;
        r4.writeHead(403);
        r4.end(e.message || String(e));
        log(r1, 'Denied %s', this.path);
    }

    /**
     * 检查响应头，检查设置zip,cache等，为r4准备头
     * @param r3 {response} Google response
     */
    this.prepare = function (r3) {
        this.r3_content_length = parseInt(r3.headers['content-length'] || -1);
        if (this.r3_content_length > CONF.max_transmit_size)
            throw new Error('Size exceeds');
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
        // ipv4.google.com/sorry/IndexRedirect
        if (r3.statusCode == 302 && 'location' in r3.headers) {
            this.r4_headers['location'] = r3.headers['location'].replace(/\w+\.google\.com/g, this.origHost);
        }
    };


    /**
     *
     * @param len {int}
     * @param zipped {boolean}
     */
    this.sendHeader = function (len, zipped) {
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
        if (len)
            this.r4_headers['content-length'] = len;
        if (CONF.server_header)
            this.r4_headers['server'] = CONF.server_header;
        this.r4.writeHead(this.r3_statusCode, this.r4_headers);
    };

    /**
     * if zipped response then call by unzip
     * @param err
     * @param body {Buffer}
     */
    this.send = function (err, body) {
        if (body.length) {
            body = processContent(this.path, this.r3_contentType, body);
        }
        // 有数据,且允许r4压缩
        if (CONF.gzip_r4 && body.length > 0) {
            zlib.gzip(body, function (err, buf) {
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

    this.doProxy = function () {
        var that = this;
        var req = client.request(this.r2_opts, function (r3) {
            try {
                that.prepare(r3);
            } catch (e) { // size
                req.abort();
                that.deny = true;
                that.r4.writeHead(403);
                that.r4.end(e.message || String(e));
                log(r1, 'Denied %s', that.path);
                return;
            }
            var zipped = that.r3_contentEncoding === 'gzip';
            if (that.textType) {
                var definite = that.r3_content_length > 0, offset = 0;
                var body = new Buffer(definite ? that.r3_content_length : 0);
                r3.on('end', function () {
                    if (zipped)
                        zlib.gunzip(body, that.send.bind(that));
                    else
                        that.send(null, body);
                    that = body = null;
                }).on('data', function (data) {
                    if (definite) {
                        data.copy(body, offset);
                        offset += data.length;
                    } else
                        body = Buffer.concat([body, data]);
                });
            } else {
                // 非文本直接通过
                that.sendHeader(that.r3_content_length, zipped);
                r3.pipe(that.r4);
                that = null;
            }
        });
        req.on('error', function (e) {
            // Error in r3.
            that.r4.writeHead(500);
            that.r4.end(e.message || String(e));
        }).end();
    }
};

var AirGooServer = function () {

    var self = this;

    this.requestHandler = function (r1, r4) {
        var origHost = r1.headers['x-forwarded-host'] || r1.headers['host'];
        if (CONF.force_https && r1.headers['x-forwarded-proto'] !== 'https') {
            r4.writeHead(301, {
                'Location': 'https://' + origHost
            });
            r4.end();
            log(r1, 'redirect to https from %s%s', origHost, r1.url);
            return;
        }
        var session = new AirGooSession(r1, r4);
        if (session.deny)
            return;
        session.origHost = origHost;
        session.doProxy();
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
            'SIGBUS', 'SIGFPE', 'SIGUSR1', 'SIGSEGV', 'SIGUSR2', 'SIGTERM'
        ].forEach(function (element, index, array) {
                process.on(element, function () {
                    self.terminator(element);
                });
            });
    };

    this.initialize = function (options) {
        self.options = options;
        self.setupTerminationHandlers();
        return self;
    };

    this.start = function () {
        if (!self.options)
            throw new Error('Not initialized');

        require('http').createServer(self.requestHandler)
            .on('listening', function () {
                log('AirGoo-Server started on %s', this._connectionKey);
            })
            .listen(self.options.port, self.options.addr);
    }

};

module.exports = AirGooServer;