# AirGoogle

项目(原nThrough)已经更名为 AirGoogle.

AirGoogle是一个快捷好用的谷歌搜索反向代理程序，还加入了一些优化处理。

- 无二次Url跳转，减少不必要等待.
- 去除了部分banner广告.
- 去除了部分log相关请求.

## Running

    $ node server.js
    - Server running and listening at 0.0.0.0:8080
    
## ChangeLog

现与Google连接使用了压缩数据，能节省不少出站流量，且能节省几十到几百ms左右

现与Google强制http连接，降低了一些远端保密性，但能节省几十到几百ms左右

更新了匹配规则，使得google.log()前的监听直接返回，节省多次/gen_204请求

修正了IE下规则失效，因Google返回不同的content-type

And so on...