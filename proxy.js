var config = require('./config');
var conf = config.sysconf;
var zlib = require('zlib'),
    util = require('util'),
    https = require(conf.backend_https ? 'https' : 'http');

var trust_proxy = conf.trust_proxy;

var rulesDefine = config.rules;

var reCookieDomain = /domain=[.\w]+/;

https.globalAgent.maxSockets = 65535;

var headerExcludes = {
	'host' : true,
	'range' : true,
	'connection' : true,
	'accept-encoding' : true,
	'transfer-encoding' : true,
	'content-encoding' : true,
	'alternate-protocol' : true
};

function copyHeaders(src, dest, host) {
	var key,
	val,
	_dest = dest || {};
	for (key in src) {
		if (!headerExcludes[key] && !key.startsWith('x-')) { // 防止x-forwarded-*
			val = src[key];
			if (key === 'set-cookie') { // 处理cookie中的domain
				if (!host)
					continue;
				val = util.isArray(val) ? val : [val];
				for (var i = 0, len = val.length; i < len; i++)
					val[i] = val[i].replace(reCookieDomain, 'domain=.' + host);
			}
			if (key === 'cookie' && !host)
				continue;
			_dest[key] = val;
		}
	}
	return _dest;
}

function processContent(path, contentType, content) {
	var rules;
	if (contentType.contains('html')) {
		rules = rulesDefine.html;
	} else if (contentType.contains('json')) {
		rules = rulesDefine.json;
	} else if (contentType.contains('javas')) {
		rules = rulesDefine.js;
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

function buildReuqest(req) {
	var path = req.url + (req.url.indexOf('?') < 0 ? '?' : '&') + 'hl=zh-CN&nord=1',
	options = {
		hostname : 'www.google.com',
		path : path
	};
	if (path.startsWith('/!')) {
		var sp = path.indexOf('/', 1);
		options.hostname = path.substring(2, sp);
		options.path = path.substr(sp);
		options.extra = true;
	}
	options.headers = copyHeaders(req.headers, {
			'Connection' : 'keep-alive',
			'Accept-Encoding' : 'gzip'
		});
	return options;
}

function log(msg, req) {
	var client = req ? ((trust_proxy && req.headers['x-forwarded-for']) || req.connection.remoteAddress) : '-.-.-.-';
	if (msg.length > 120)
		msg = msg.substr(0, 120);
	util.log(client + ' - ' + msg);
}

/**
 * 请求会话
 */
function GSession(r1) {
	this.r1 = r1;
	this.path = r1.url;
}

apply(GSession.prototype, {

	prepare : function (response) {
		this.r3_statusCode = response.statusCode;
		this.r3_contentType = response.headers['content-type'];
		this.r3_contentEncoding = response.headers['content-encoding'];
		this.compressible = /(text|json)/.test(this.r3_contentType);
		this.cacheable = !/(html|json)/.test(this.r3_contentType);
		this.r4_headers = copyHeaders(response.headers, {}, this.r2_opts.extra ? null : this.r1.headers['host']);
		if (conf.logging)
			log(util.format('[%s] < %s', response.statusCode, this.path), this.r1);
	},

	sendHeader : function (len, zipped) {
		if (this.cacheable && conf.force_cached_time > 0) {
			var cacheControl = this.r4_headers['cache-control'];
			if (!cacheControl || !cacheControl.startsWith('public'))
				this.r4_headers['cache-control'] = 'public';
			var expires = this.r4_headers['expires'];
			if (expires) {
				var expiresDate = new Date(expires);
				var now = new Date().getTime();
				if (expiresDate.getTime() <= now + 1000) {
					expiresDate.setTime(now + conf.force_cached_time * 1000);
					this.r4_headers['expires'] = expiresDate.toGMTString();
				}
				this.r4_headers['X-Accel-Expires'] = '@' + ((expiresDate.getTime() / 1000) >> 0);
			} else {
				this.r4_headers['X-Accel-Expires'] = String(conf.force_cached_time * 1000);
			}
		}
		if (zipped)
			this.r4_headers['content-encoding'] = 'gzip';
		if (len)
			this.r4_headers['content-length'] = len;
		if (conf.server_header)
			this.r4_headers['server'] = conf.server_header;
		this.r4.writeHead(this.r3_statusCode, this.r4_headers);
	},

	send : function (err, body) {
		if (body.length)
			body = processContent(this.path, this.r3_contentType, body);
		if (conf.gzip_r4 && body.length > 0) { // 可压缩且有数据
			zlib.gzip(body, function (err, buf) {
				this.sendHeader(buf.length, true);
				this.r4.end(buf);
			}.bind(this));
		} else {
			this.sendHeader(body.length);
			this.r4.end(body);
		}
	},

	doProxy : function (r4) {
		this.r4 = r4;
		this.r2_opts = buildReuqest(this.r1);
		var that = this;
		https.request(this.r2_opts, function (r3) {
			that.prepare(r3);
			if (that.compressible) {
				var body = new Buffer(0);
				r3.on('end', function () {
					if (that.r3_contentEncoding === 'gzip')
						zlib.gunzip(body, that.send.bind(that));
					else
						that.send(null, body);
				}).on('data', function (data) {
					body = Buffer.concat([body, data]);
				});
			} else { // 非文本直接通过
				that.sendHeader();
				r3.pipe(r4);
			}
		}).on('error', function (e) {
			r4.writeHead(e.statusCode);
			r4.end(String(e));
		}).end();
	}
});

module.exports = function (r1, r4) {
	if (conf.force_https && r1.headers['x-forwarded-proto'] !== 'https') {
		r4.writeHead(301, {
			'Location': 'https://' + r1.headers['host'] + r1.url
		});
		r4.end();
	}
	if (r1.url.startsWith('/gen_204')) {
		r4.writeHead(204);
		r4.end();
	} else
		new GSession(r1).doProxy(r4);
};
