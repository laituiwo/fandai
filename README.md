# AirGoo

提供最便捷的方法还原谷歌服务。

如有建议或需帮助请在[issues](https://github.com/spance/AirGoo/issues)中提出。

# Features

力求顺畅和逼真是首要目标，另外还有：

- 搜索结果没有二次Url跳转不需要等待
- 去除了部分推销广告
- 减少传输量和次数(启用Cache)

# 原理和解释

受限于某些黑政策，国内都无法使用Google服务，尤其是搜素服务，而且目前地球上还没有其它替代品（人生苦短请不要浪费在其它自称为搜索的产品上），于是便有各种方法来曲径通幽。各种隧道和翻墙工具就不多说了，做为重量级手段它们都是正确的稳妥的，但对于一个高频度使用的Google服务来说，反代显然是所有方法中最便捷的。

然而，反代Google近乎完美的提供服务并不是想想的那么容易，AirGoo就是为了解决这些问题而产生的，只要你的链路够快，AirGoo就能提供近乎完美和逼真的基础Google体验。当然Google的产品线十分庞大和复杂，AirGoo不可能还原所有的Google服务，以最常用的搜素为基本服务内容。

这里不提供demo和直接可用的服务，开源就是为了“渔”而不是“鱼”，让翻越从单点集中迈向散点分布式。

工作原理和推荐的工作模式：**二级/多级中间缓存** 

![二级/多级中间缓存](https://i.imgur.com/nU5lCui.png)

AirGoo会检查和使用一定缓存策略，让Nginx对静态资源进行缓存，除了必须的查询其它请求都将由Cache回复，此举可以省掉92%请求量(首页)，不但大大的节省了出站流量，也让前端响应也变得更快。

# 安装

首先需要一个无障碍的境外服务器或云环境。

需要 `Node.js` 运行环境，使用 `apt-get/yum` 等安装或从 [http://nodejs.org/download/](http://nodejs.org/download/) 下载。

[下载本项目](https://github.com/spance/AirGoo/archive/master.zip)至任意位置。

目前仅有基于Node.js实现的版本，以后会增加其它语言的实现。

为了应对Google的更新变化，请关注并跟随版本升级。

# 运行

基本运行方式：

```
$ node server.js
- AirGoo-Server started on 4:0.0.0.0:8080
```

后台服务运行的方式有很多，常见方法都适用；更简单的通用大法，以`screen`命令来保持应用。

在结构上，通常应该以Nginx/Apache等作为前端入口提供https/spdy服务，缓存及分发请求到后端AirGoo，尤其是独立服务器/IaaS/VPS用户。

若要提供公开的服务，则建议部署为中小规模集群1\*Nginx + N\*AirGoo，但不建议这么做，除非能拥有很多的出站地址以防滥用嫌疑和很多的入站地址来防黑政策。

# 配置

独立服务器/VPS/IaaS用户，前端Nginx可以参考 [Wiki示意配置](https://github.com/spance/AirGoo/wiki)，建议在Nginx中启用spdy协议（建议1.7.3以上版本或自行编译）。

通常各类PaaS都使用环境变量、运行配置文件定义运行方法，用户应用的前通常有Nginx等做为前端路由(和https)，由其虚拟容器托管运行，相当于二级无缓存的模式。

## 启动参数

- 监听地址，命令行参数[-a 0.0.0.0] `>` 参数文件[listen_address] `>` 默认[0.0.0.0]
- 监听端口，命令行参数[-p 8080] `>` 参数文件[listen_port] `>` 默认[8080]
- 工作参数文件，命令行参数[-c file] `>` 环境变量[AIRGOO_CONF] `>` 默认当前目录[config.json]

命令参数 `-h` 查看此类帮助，这里的`>`表示作用优先级左端高于右端。

## 工作参数

配置在config.json中，标准json格式。

```json
{
    // 监听地址，优先级低于命令参数
    // 允许 "1.2.3.4" 常量值形式
    // 允许 "{IP}" 用环境变量IP值，PaaS用户请查阅服务商指南
    "listen_address": "0.0.0.0",
    
    // 监听端口，优先级低于命令参数
    // 允许 8080 常量值形式
    // 允许 "{PORT}" 用环境变量PORT值，PaaS用户请查阅服务商指南
    "listen_port": 8080,
    
	// 通常PaaS/CDN都能正确的发送x-forwarded头，而自部署Nginx用户需要参考wiki示意
	// 强制要求入口访问协议https，通过http-header.x-forwarded-proto进行判断
    "force_https": true,  

	// 强制要求出站访问（R2阶段）使用https，若私密性要求不高，可置为false节省连接时间
    "backend_https": false,  

	// 添加自定义server头，置为null则不添加。
    "server_header": "AirGoo",  

	// 当后端要求不缓存，是否忽略并强制缓存，单位秒。若允许无缓存的请求，则置为负数
    "force_cached_time": 1800,  

	// 处理完返回响应时（R4阶段）是否用gzip压缩
	// 有独立Server/VPS/CDN等前端，则应该优先使用前端压缩
	// 在Paas环境的前置nginx通常都不会自动压缩，所以需要打开
    "gzip_r4": false,  

	// 是否启用简单log日志
    "logging": true,  

	// 是否信任前端转发地址为真实用户地址（在nginx/cdn/paas后时打开）
    "trust_proxy": true,  

	// 声明优先语言
    "prefer_lang": "zh-CN",
    
	// 限制每请求最大通行文件的大小，单位byte
    "max_transmit_size": 10485760,  
    
    // 目标 @since 1.1.3
    "target_google": {
        "host": "www",
        "domain": "google.com"
    },

	// 允许通行的第三方域，无通配符无正则
    "ext_domains": [  
        ".google.com",
        ".gstatic.com",
        ".googleapis.com",
        ".googleusercontent.com"
    ]
}
```

**注**：正式启用的`config.json`中不要包含上述注释。


# ChangeLog

V1.1.3

调整国别域跳转处理方法

新方式处理可能的abuse情况

反代目标的动态处理

优化和调整规则

maps基本可用

V1.1.2

增加addr,port定义到文件

改为绝对地址适应外部运行

V1.1.1

修复content-length错误；

修复命令参数提取错误；

V1.1.0

优化和重写部分，加快内存释放；

配置文件独立，增加了配置参数；

增加了图片搜索处理规则和规则优化；

对可能出现的验证码做了处理；

加入了它域通行规则和大小限制；


V1.0.0

增加了expires等缓存过期策略的处理，为前置缓存做最大的调整处理；

增加了配置定义文件，目前提供7项可配置项，为不同工作模式调整配置；

更新了过滤规则，滤掉pushdown_promo等；

V0.5

现与Google连接使用压缩数据，能节省不少出站流量，且能节省几十到几百ms左右

现与Google强制http连接，降低了一些远端保密性，但能节省几十到几百ms左右

更新了匹配规则，使得google.log()前的监听直接返回，节省多次/gen_204请求

修正了IE下规则失效，因Google返回不同的content-type

修正了cookie域问题

And so on...
