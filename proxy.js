var https = require("http");
var util = require('util');
var zlib = require('zlib');

util.apply = function (o, c, defaults) {
	if (defaults) {
		util.apply(o, defaults);
	}
	if (o && c && typeof c == 'object') {
		for (var p in c) {
			o[p] = c[p];
		}
	}
	return o;
};

util.apply(String.prototype, {
	contains : function (str) {
		return str && this.indexOf(str) > -1;
	},
	startsWith : function (prefix) {
		return prefix && this.length >= prefix.length && this.substring(0, prefix.length) === prefix;
	},
	endsWith : function (suffix) {
		return suffix && this.length >= suffix.length && this.slice(-suffix.length) === suffix;
	},
	hashCode : function () {
		if (this.length === 0)
			return 0;
		var hash = 0,
		charAt,
		i,
		len = this.length;
		for (i = 0; i < len; i++) {
			charAt = this.charCodeAt(i);
			hash = ((hash << 5) - hash) + charAt;
			hash = hash & hash; // Convert to 32bit integer
		}
		return hash;
	}
});

var trust_proxy = process.env.trust_proxy === false ? false : true;

var rulesDefine = {
	html : [{
			"pathRegex" : /\/(search|webhp)/,
			"pattern" : /onmousedown=\"[^\"]+?\"/g,
			"replacement" : "target=\"_blank\""
			/* 换掉 /search rwt */
		}, {
			"pathRegex" : /\/(search|webhp)/,
			"pattern" : /onmousedown\\\\x3d\\\\x22.+?\\\\x22/g,
			"replacement" : "target\\\\x3d\\\\x22_blank\\\\x22"
		}, {
			"pattern" : /,pushdown_promo:'[^']+?'/g,
			"replacement" : ""
			/* 滤掉手机顶部banner */
		}, {
			"pattern" : /\/\/(?=ssl\.)/g,
			"replacement" : "/!"
			/* 重写绝对地址 */
		}, {
			"pattern" : /([htps]+:)?\/\/www\.google\.com/g,
			"replacement" : ""
			/* 重写绝对地址 */
		}, {
			"pattern" : /google\.log=/,
			"replacement" : "google.log=function(){};_log="
			/* 禁用log，去掉gen_204请求 */
		}
	],
	js : [{
			"pattern" : /([htps]+:)?\/\/www\.google\.com/g,
			"replacement" : ""
			/* 重写xjs,rs绝对地址 */
		}, {
			"pattern" : /_\.mg=/,
			"replacement" : "_.mg=function(){};_mg="
			/* 禁用监听，去掉gen_204请求 */
		}
	],
	json : [{
			"pattern" : /onmousedown\\\\x3d\\\\x22.+?\\\\x22/g,
			"replacement" : "target\\\\x3d\\\\x22_blank\\\\x22"
		}
	]
};

var reCookieDomain = /domain=[.\w]+/;

https.globalAgent.maxSockets = 65535;

var headerExcludes = {
	'host' : true,
	'range' : true,
	'connection' : true,
	'content-length' : true,
	'accept-encoding' : true,
	'transfer-encoding' : true,
	'content-encoding' : true,
	'alternate-protocol' : true
};

function copyHeaders(src, dest, host) {
	var key, val, _dest = dest || {};
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
function GSession(req) {
	this.req = req;
	this.path = req.url;
}

util.apply(GSession.prototype, {

	prepare : function (response) {
		this.proxyStatusCode = response.statusCode;
		this.proxyContentType = response.headers['content-type'];
		this.proxyContentEncoding = response.headers['content-encoding'];
		this.compressible = /(text|json)/.test(this.proxyContentType);
		this.resHeaders = copyHeaders(response.headers, {}, this.req_opts.extra ? null : this.req.headers['host']);
		log(util.format('[%s] < %s', response.statusCode, this.path), this.req);
	},

	sendHeader : function (len, zipped) {
		if (zipped) {
			this.resHeaders['Content-Encoding'] = 'gzip';
		}
		this.resHeaders['Content-Length'] = len;
		this.res.writeHead(this.proxyStatusCode, this.resHeaders);
	},

	send : function (err, body) {
		if (this.proxyContentType) {
			body = processContent(this.path, this.proxyContentType, body);
		}
		if (this.compressible && body.length > 0) { // 可压缩且有数据
			zlib.gzip(body, function (err, buf) {
				this.sendHeader(buf.length, true);
				this.res.end(buf);
			}
				.bind(this));
		} else {
			this.sendHeader(body.length);
			this.res.end(body);
		}
	},

	doProxy : function (res) {
		this.res = res;
		this.req_opts = buildReuqest(this.req);
		var that = this;
		https.request(this.req_opts, function (pxRes) {
			that.prepare(pxRes);
			var body = new Buffer(0);
			pxRes.on('end', function () {
				if (that.proxyContentEncoding === 'gzip')
					zlib.gunzip(body, that.send.bind(that));
				else
					that.send(null, body);
			});
			pxRes.on('data', function (data) {
				body = Buffer.concat([body, data]);
			});
		}).on('error', function (e) {
			res.writeHead(e.statusCode);
			res.end(e.message);
		}).end();
	}
});

module.exports = function (req, res) {
	var proto = req.headers['x-forwarded-proto'];
	if (proto === 'https') {
		if (req.url.startsWith('/gen_204')) {
			res.writeHead(204);
			res.end();
		} else
			new GSession(req).doProxy(res);
	} else {
		res.writeHead(301, {
			'Location' : 'https://' + req.headers['host'] + req.url
		});
		res.end();
	}
};
