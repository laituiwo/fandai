# AirGoogle

项目(原nThrough)已经更名为 AirGoogle.

AirGoogle是一个快捷好用的谷歌搜索反向代理程序，还加入了一些优化处理。

- 无二次Url跳转，减少不必要等待.
- 去除了部分banner广告.
- 去除了部分log相关请求.
- ....

总之不光是还原一个Google，还要更好用的Google.

## Run

    $ node server.js
    - Server running and listening at 0.0.0.0:8080
    
## ChangeLog

现与Google连接使用压缩数据，能节省不少出站流量，且能节省几十到几百ms左右

现与Google强制http连接，降低了一些远端保密性，但能节省几十到几百ms左右

更新了匹配规则，使得google.log()前的监听直接返回，节省多次/gen_204请求

修正了IE下规则失效，因Google返回不同的content-type

修正了cookie域问题

And so on...

## Plan

计划增加与nginx前后端搭配，并把压缩工作转交给nginx完成；

计划进一步压榨缩小Google通信数据，要纯纯的搜索 木有广告！