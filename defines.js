var util = require('util'),
    fs = require('fs'),
    path = require('path');

var basedir;

var VERSION = (function () {
    basedir = path.dirname(__filename);
    var packageFile = fs.readFileSync(path.join(basedir, 'package.json'));
    return JSON.parse(packageFile)['version'];
})();

var default_config = {
    force_https: true,
    backend_https: false,
    server_header: 'AirGoo',
    force_cached_time: 1800,
    gzip_r4: false,
    logging: true,
    trust_proxy: true,
    prefer_lang: 'zh-CN',
    max_transmit_size: 10485760
};

var rules = {
    html: [
        {
            "pathRegex": /\/(search|webhp)/,
            "pattern": /onmousedown="[^\"]+?"/g,
            "replacement": "target=\"_blank\""
            /* /search @mobi */
        },
        {
            "pathRegex": /\/(search|webhp)/,
            "pattern": /(?:http(?:s)?:)?\/\/(?=id\.go)/,
            "replacement": "/!"
            /* @mobi */
        },
        {
            "pattern": /(?:http(?:s)?:)?\/\/(?=\w+\.gstatic)/g,
            "replacement": "/!"
            /* gstatic */
        },
        {
            "pattern": /(?:http(?:s)?:)?\/\/www\.google\.com/g,
            "replacement": ""
            /* /main res */
        },
        {
            "pattern": /pushdown_promo:/,
            "replacement": "_:"
            /* 顶部promo */
        },
        {
            "pattern": /google\.log=/,
            "replacement": "google.log=function(){};_log="
            /* 禁用log gen_204 */
        }
    ],
    js: [
        {
            "pattern": /(?:http(?:s)?:)?\/\/www\.google\.com/g,
            "replacement": ""
            /* 重写xjs,rs绝对地址 */
        },
        {
            "pathRegex": /\/xjs/,
            "pattern": /window\.Image/g,
            "replacement": "Object"
        },
        {
            "pattern": /_\.mg=/,
            "replacement": "_.mg=function(){};_mg="
            /* 禁用监听 gen_204 */
        },
        {
            "pathRegex": /\/search/,
            "pattern": /(?:http(?:s)?:)?\/\/(?=\w+\.gstatic)/g,
            "replacement": "/!"
        }
    ],
    json: [
        {
            "pattern": /onmousedown\\\\x3d/g,
            "replacement": "target\\\\x3d\\\\x22_blank\\\\x22 rwt\\\\x3d"
        },
        {
            "pattern": /\(\\\/\\\/(?=\w+\.gstatic)/g,
            "replacement": "(\/!"
            // css url
        }
    ]
};

var ext_domains = [
    '.google.com',
    '.gstatic.com',
    '.googleapis.com',
    ".googleusercontent.com"
];

var helps = [
        'AirGoo v' + VERSION,
    '\t A shortcut to access Google service, Beating the firewall.',
    '',
    'More information:',
    '\t AirGoo@Github <http://github.com/spance/AirGoo>',
    'If you need help, you could ask questions on AirGoo@Github.issues',
    '',
    [
        'Usage: node', mainName()[1],
        '[-a address]', '[-p port]', '[-c config file]'
    ].join(' ')
];

var excludedHeaders = {
    'host': true,
    'range': true,
    'connection': true,
    'accept-encoding': true,
    'transfer-encoding': true,
    'content-encoding': true,
    'alternate-protocol': true
};


var EOF = '\0';
var whiteList = null;
var config = null;


/**
 * 构造Trie
 * @param list dict string list
 * @returns {{}}
 */
function buildSuffixTrie(list) {
    var lLen = list.length;
    var tree = {};
    for (var j = 0; j < lLen; j++) {
        var s = list[j], sLen = s.length, parent, level = null;
        for (var char, i = sLen - 1; i >= 0; i--) {
            char = s[i];
            parent = level || tree;
            level = parent[char] || (parent[char] = {});
        }
        level[EOF] = true;
    }
    return tree;
}


/**
 *
 * @param domain
 * @param gte_min {boolean} must be greater than or equal the shortest word length of whole dict.
 * @returns {boolean}
 */
function searchTrie(domain, gte_min) {
    var level, parent = whiteList;
    for (var i = domain.length - 1; i >= 0; i--) {
        level = parent[domain[i]];
        if (!level)
            return false;
        if (level[EOF])  // gt_min hook
            return true;
        parent = level;
    }
    return gte_min || EOF in level;
}


/**
 * from ExtJs3
 * @param dest
 * @param src
 * @param defaults
 * @returns {*}
 */
var apply = function (dest, src, defaults) {
    if (defaults) {
        apply(dest, defaults);
    }
    if (dest && src && typeof src === 'object') {
        for (var p in src) {
            dest[p] = src[p];
        }
    }
    return dest;
};


function mainName() {
    var fullpath = process.mainModule.filename, name = path.basename(fullpath);
    return [fullpath, name];
}


function initialize() {
    var user = {}, env = process.env;
    var opts = parse_options({
        addr: '0.0.0.0',
        port: 8080,
        conf: env.AIRGOO_CONF || env.airgoo_conf || 'config.json'
    });
    opts.conf = path.join(basedir, opts.conf);
    if (fs.existsSync(opts.conf)) {
        var file = fs.readFileSync(opts.conf); // maybe throw
        user = JSON.parse(file); // maybe throw
        var applyEnv = function (ma, g1) {
            if (g1 in process.env)
                return env[g1];
            else
                abort(format('Invalid environment variable "%s" for listen_address', g1));
        };
        // 0xf: addr set
        if (user.listen_address && !(opts.priority & 0xf))
            opts.addr = String(user.listen_address).replace(/\{(\w+)\}/g, applyEnv);
        // 0xf0: port set
        if (user.listen_port && !(opts.priority & 0xf0)) {
            var port = String(user.listen_port).replace(/\{(\w+)\}/g, applyEnv);
            if (!/^\d+$/.test(port) || (port = parseInt(port), false) || port > 65535 || port < 0)
                abort(format('Invalid listen port %d in %s', port, opts.conf));
            else
                opts.port = port;
        }
    }
    whiteList = buildSuffixTrie(user.ext_domains || ext_domains);
    config = apply({}, user, default_config);
    return opts;
}


function abort(msg) {
    var args = util.isArray(msg) ? msg : ['Error: ', msg];
    args.push(' ');
    util.puts.apply(util, args);
    process.exit(1);
}


function parse_options(defaults) {
    var args = [], _mainName = mainName()[0];
    process.argv.forEach(function (item, i) {
        if (item === _mainName) {
            args = process.argv.slice(i + 1);
            return false;
        }
    });
    var opts = {};
    for (var token; args.length > 0;) {
        token = args.shift();
        switch (token) {
            case '-a':
                token = args.shift();
                if (!token)
                    abort('Option requires an argument -a (listen address)');
                opts.addr = token;
                opts.priority |= 0xf;
                break;
            case '-p':
                token = args.shift();
                if (!token)
                    abort('Option requires an argument -p (listen port)');
                var port;
                if (!/^\d+$/.test(token) || (port = parseInt(token), false) || port > 65535 || port < 0)
                    abort('Invalid listen port ' + token);
                opts.port = parseInt(port);
                opts.priority |= 0xf0;
                break;
            case '-c':
                token = args.shift();
                if (!token)
                    abort('Option requires an argument -c (config file)');
                if (!fs.existsSync(token))
                    abort(token + ' not exists.');
                opts.conf = token;
                break;
            case '-v':
            case '-h':
            case '--help':
                abort(helps);
                break;
            default:
                abort('Invalid option ' + token);
        }
    }
    return apply({}, opts, defaults)
}

function pad(n) {
    return n < 10 ? '0' + n.toString(10) : n.toString(10);
}

var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// from nodejs.util
function timestamp() {
    var d = new Date();
    var time = [pad(d.getHours()), pad(d.getMinutes()), pad(d.getSeconds())].join(':');
    return [d.getDate(), months[d.getMonth()], time].join(' ');
}

/**
 * 简化和改良printf方法，较util.format提升约一半。
 * 对参数中长字符串做截断.
 * 可用的Specifier {%s, %d, %j, %t}
 * @param fmt
 * @returns {*}
 */
var format = function split(fmt) {
    var parts = fmt.split('%'), len = parts.length;
    var res = parts[0];
    for (var x, i = 1, j = 1; i < len; i++) {
        x = parts[i][0];
        switch (x) {
            case 's':
                res += String(arguments[j++]).substring(0, 120);
                res += parts[i].substr(1);
                break;
            case 'd':
                res += arguments[j++];
                res += parts[i].substr(1);
                break;
            case 't':
                res += timestamp();
                res += parts[i].substr(1);
                break;
            case 'j':
                try {
                    res += JSON.stringify(arguments[j++]);
                } catch (_) {
                    res += '[Circular]';
                }
                res += parts[i].substr(1);
                break;
            default:
                if (x || (!x && ++i < len)) {
                    res += '%';
                    res += parts[i];
                }
        }
    }
    return res;
};


module.exports = {

    version: VERSION,
    rules: rules,
    excludedHeaders: excludedHeaders,

    apply: apply,
    allow: searchTrie,
    initialize: initialize,
    format: format,

    config: function () {
        return config;
    },

    contains: function (self, key) {
        return self && key && self.indexOf(key) > -1;
    },

    startsWith: function (self, prefix) {
        return prefix && self.length >= prefix.length && self.substring(0, prefix.length) === prefix;
    },

    endsWith: function (self, suffix) {
        return suffix && self.length >= suffix.length && self.slice(-suffix.length) === suffix;
    }
};