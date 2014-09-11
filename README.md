# AirGoogle

AirGoogle是一个快捷好用的谷歌搜索反向代理程序，还加入了很多优化处理。

- 无二次Url跳转，减少不必要等待
- 去除了部分banner广告
- 去除了部分无关请求
- 极少的通信量、极少的通信次数（启用前置Cache）
- ....

总之，不光要还原Google，要更轻便快的Google.

## 运行

    $ node server.js
    - Server running and listening at 0.0.0.0:8080

## 工作模式

AirGoogle不同于其它直接Nginx反代形式，因直接反代出站不能压缩，流量大传输慢，响应处理的很有限且灵活度不足。

AirGoogle推荐两种工作模式：

### 一级无中间缓存

![一级无中间缓存](https://i.imgur.com/MmXbBRj.png)
所有请求都将通过AirGoogle处理和传递。

### 二级有中间缓存

![二级有中间缓存](https://i.imgur.com/nU5lCui.png)
此模式下，AirGoogle使用一定缓存策略，让Nginx对静态资源进行缓存，除了必须的查询其它请求都将由Cache回复，此举可以省掉92%请求量，不但大大的节省了出站流量，也让前端响应也变得更快。

**注：图中红线强烈建议部署为HTTPS的加密通信，绿线可选部署（一般建议HTTP）。**

**注：此模式下，可部署为中大规模集群（1*Nginx + N*AirGoogle或其它），任意upstream策略都能工作的很好，且后端压力和流量极少。**

**注：两层后，强烈建议在Nginx中启用spdy协议。**

若部署条件允许，推荐采用二级有中间缓存模式，可以减轻通信、提升访问速度。
	
## 配置

配置文件方式：

```javascript
// config.js 默认配置
// 根据注释调节选项，但不要更改键名key和其它内容。
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
```

环境变量优先的配置方式：

```shell
export env_pri=true			# 首先定义环境变量env_pri=true 声明环境变量作用优先；
export force_https=false	# 例：用环境变量force_https作配置；
export CONFIG_KEY=VALUE		# 例：用环境变量CONFIG_KEY配置为VALUE；
```

**注：两层模式下的Nginx的推荐配置会在Wiki中发布。**

## ChangeLog

V1.0

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
