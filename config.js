var default_config = {
	/**
	 * force_https		强制要求入口访问协议https，通过http-header.x-forwarded-proto进行判断。
	 */
	force_https: true
	/**
	 * backend_https	强制要求出站访问（R2阶段）使用https，若私密性要求不高，可以置为false节省些连接时间。
	 */
	,backend_https : false
	/**
	 * server_header	添加自定义server头，置为null则不添加。
	 */
	,server_header : 'MyServer'
	/**
	 * force_cached_time	若后端指示不缓存，是否忽略并强制缓存的时间，单位秒。若允许无缓存的请求，则置为负数。
	 */
	,force_cached_time : 1800
	/**
	 * gzip_r4			处理完返回响应时（R4阶段）是否用gzip压缩。若有前置nginx代理/CDN，则应该优先使用nginx压缩。
	 */
	,gzip_r4 : false
	/**
	 * logging			是否启用简单log日志
	 */
	,logging : true
	/**
	 * trust_proxy		是否信任前端代理获取真实ip地址（工作在nginx或cdn后端时需要打开）。
	 */
	,trust_proxy : true
};

var rules = {
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
			"pattern" : /pushdown_promo:/,
			"replacement" : "_:"
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

global.apply = function (o, c, defaults) {
	if (defaults) {
		apply(o, defaults);
	}
	if (o && c && typeof c == 'object') {
		for (var p in c) {
			o[p] = c[p];
		}
	}
	return o;
};

apply(String.prototype, {
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

var sysconf = (function () {
	var env_pri = process.env.ENV_PRI;
	if (env_pri)
		return apply({}, process.env, default_config);
	else
		return default_config;
})();

module.exports = {
	sysconf : sysconf,
	rules : rules
};
