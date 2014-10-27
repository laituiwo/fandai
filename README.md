# AirGoo

AirGoo专注于反代形式提供谷歌搜索服务，以轻便快为奋斗目标。

- 无二次Url跳转，要直接不要等待
- 去除了部分banner广告
- 去除了部分无关请求
- 极少的通信量和通信次数(启用Cache)
- ....

如需帮助请在项目issues中提问。

# 安装和运行

需要NodeJs 0.10.x运行环境。

使用apt-get, yum等安装 ` sudo apt-get install nodejs npm ` 或从 [http://nodejs.org/download/](http://nodejs.org/download/) 下载；

[下载本项目](https://github.com/spance/AirGoo/archive/master.zip)至任意位置；

基本运行方式：

```
$ node server.js
- AirGoo-Server started on 4:0.0.0.0:8080
```

若需要以后台服务方式运行，安装 `node-supervisor` 或 `forever`，或upstart/service-rc.d等，并阅读其配置指南。

更简单的方式则是在`screen`命令下运行保持应用不离线，更多信息`man screen`手册。

**注**：通常应该以Nginx/Apache等作为前端入口并提供https/spdy服务，与后端AirGoo协同工作，尤其是独立服务器/VPS用户。

**注**：为了应对Google的更新变化，请关注并跟随版本升级。

# 工作模式

AirGoo不同于直接Nginx反代，因其出站不能压缩，流量大延迟高、处理有限不够灵活。

AirGoo推荐的工作模式： **二级/多级中间缓存**

![二级/多级中间缓存](https://i.imgur.com/nU5lCui.png)

此模式下，AirGoo使用一定缓存策略，让Nginx对静态资源进行缓存，除了必须的查询其它请求都将由Cache回复，此举可以省掉92%请求量(首页)，不但大大的节省了出站流量，也让前端响应也变得更快。

**注**：可部署为中小规模集群（1*Nginx + N*AirGoo），任意upstream策略都能工作的很好，且后端压力和流量极少。

**注**：建议在Nginx中启用spdy协议。（需要1.6以上版本或自行编译）

# 配置

独立服务器/VPS/IaaS用户，前端的Nginx/Apache可以 **参考项目[Wiki](https://github.com/spance/AirGoo/wiki)中示意配置。**

通常各类PaaS都使用环境变量，和其运行配置文件定义运行命令行，用户应用的前面有Nginx等做为前端路由（可能有https支持），并由其虚拟容器托管运行，因此相当于二级无中间缓存的模式。

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

	// 允许通行的第三方域，无通配符无正则
    "ext_domains": [  
        ".google.com",
        ".gstatic.com",
        ".googleapis.com",
        ".googleusercontent.com"
    ]
}
```

**注**：从1.0.0升级的用户，请注意转移对应的配置到`config.json`中。

**注**：正式启用的`config.json`中不要包含上述注释。

# ChangeLog

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
