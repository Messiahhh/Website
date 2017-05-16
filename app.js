const http = require("http"),
      fs = require("fs"),
      url = require('url'),
      path = require('path'),
      qs = require('querystring');

const conn = require('./services/connect_mysql');
const client = require('./services/connect_redis');

//解析序列化字符串=>对象,其实和qs模块差不多
const parseSeria = ({
            str,
            sep = '&',
            eq = '='
        }) => {
            let obj = {};
            if (!str) {
                return obj;
            }
            let arr = str.split(sep);
            arr.forEach((item) => {
                let arr1 = item.split(eq);
                obj[arr1[0].trim()] = arr1[1];
            })
            return obj;
        };

const key = 'session_id',
      expires = 20 * 60 * 1000;
    //   sessions = {};

//返回当前毫秒时间
const dateNow = () => {
    return (new Date()).getTime();
}
//返回计算后的GMT时间
const dateLater = (date, time) => {
    let a = new Date();
    a.setTime(date + time);
    return a.toGMTString();
}




http.createServer((req, res) => {
    //封装一些函数，挂载在req/res上
    
    //生成Set-cookie
    const serialize = ({
        name,
        val,
        opt: {
            expires = dateLater(dateNow(), expires),
        }
    }) => {
        let pairs = [`${name}=${val}`];
        if (expires) {
            pairs.push(`Expires=${expires}`);
        }
        return pairs.join(';');
    }
    

    req.query = qs.parse(url.parse(req.url).query);

    req.cookies = parseSeria({
        str: req.headers.cookie,
        sep: ';'
    });


    res.json = (json) => {
        res.writeHead(200, {
            'Content-Type': 'application/json',
        })
        res.end(JSON.stringify(json));
    }
    
    res.redirect = (url) => {
        res.writeHead(302, {
            'Location': url,
        })
        res.end(`Location to ${url}`);
    }

    

    res.render = (file) => {
        fs.readFile(file, (err, data) => {
            res.writeHead(200, {
                'Content-type': 'text/html',
            })
            res.write(data);
            res.end();
        })
    }

    //生成session
    // const generate = () => {
    //     let session = {};
    //     session.id = dateNow();
    //     session.cookie = {
    //         'expires': dateLater(dateNow(), expires),
    //     }
    //     sessions[session.id] = session;
    //     return session;
    // }

    //生成session保存到redis
    const generate = ({
        usr,
    }) => {
        let key = dateNow();
        client.hset(key, 'usr', usr);
        client.hset(key, 'id', key);
        client.expire(key, 20 * 60);
        return {
            id: key,
            usr: usr,
        }
    }
    
    
    // 业务逻辑
    //服务端的session暂时不能自动删除，晚点用Redis代替对象储存session

    // index --- 登录页面
    if (req.url === '/index') {
        let id = req.cookies[key];
        if (!id) {
            res.render('loginPage.html');
        }
        else {
            client.hget(id, 'usr', (err, data) => {
                if (err) {
                    console.log(err);
                }
                else {
                    if (data) {
                        res.redirect("/");
                    }
                    else {
                        res.render('loginPage.html');
                    }
                }
            })
        }
    }
    // login --- 登录路由
    else if (req.url === '/login') {
        if (req.method === 'POST') {
            let segment = [];
            req.on('data', (chunk) => {
                segment.push(chunk);
            })
            req.on('end', () => {
                segment = Buffer.concat(segment).toString();
                let postData = parseSeria({
                    str: segment,
                });
                let usr = postData.usr,
                    psd = postData.psd;
                conn.query('SELECT * FROM user WHERE username = ? AND password = ?', [usr, psd], (err, data) => {
                    if (err) {
                        console.log(err);
                    }
                    else if (data && data.length !== 0) {
                        req.session = generate({
                            usr: usr,
                        });
                        res.writeHead(200, {
                            'Set-Cookie': serialize({
                                name: key,
                                val: req.session.id,
                                opt: {
                                    expires: dateLater(dateNow(), expires),
                                }
                            }),
                        })
                        res.end(JSON.stringify({
                            status: 200,
                            info: 'success'
                        }));
                    }
                    else {
                        res.json({
                            status: 400,
                            info: "fail",
                        })
                    }
                })
            })
        }
    }
    //注册
    else if (req.url === '/reg') {
        if (req.method === 'POST') {
            let segment = [];
            req.on('data', (chunk) => {
                segment.push(chunk);
            })
            req.on('end', () => {
                segment = Buffer.concat(segment).toString();
                let postData = parseSeria({
                    str: segment,
                });
                let usr = postData.usr,
                    psd = postData.psd;
                conn.query('SELECT * FROM user WHERE username = ?', [usr], (err, data) => {
                    if (err) {
                        console.log(err);
                    }
                    else {
                        if (data && data.length !== 0) {
                            res.json({
                                status: 400,
                                info: "fail",
                            });
                        }
                        else {
                            conn.query('INSERT INTO user VALUE(?,?,?)', [null, usr, psd], (err) => {
                                if (err) {
                                    console.log(err);
                                }
                                else {
                                    res.json({
                                        status: 200,
                                        info: 'success'
                                    })
                                }
                            })
                        }
                    }
                })
            })
        }
    }
    else if (req.url === '/') {
        let id = req.cookies[key];
        //session_id没有值
        if (!id) {
            res.redirect('/index');
        }
        else {

            client.hget(id, 'usr', (err, data) => {
                if (err) {
                    console.log(err);
                }
                else {
                    if (data) {
                        res.render('index.html');
                    }
                    else {
                        res.redirect('/index');
                    }
                }
            })
            // let session = sessions[id];
            //sessions中有对应的值
            // if (session) {
                //如果过期了
                // if (sessions[id].cookie.expires < dateNow()) {
                //     delete sessions[id];
                //     req.session = generate();
                // }
                // //没过期,更新expires
                // else {
                //     sessions[id].cookie.expires = dateLater(dateNow(), expires);
                //     res.render('index.html');
                // }

                // sessions[id].cookie.expires = dateLater(dateNow(), expires);
                // res.render('index.html');
            // }
            //sessions中没有对应的值          
            // else {
                // res.redirect('/index');
            // }
        }
        
    }
    //静态文件
    else {
        let root = path.resolve(process.argv[2] || '.');
        // 获得URL的path，类似 '/css/bootstrap.css':
        let pathname = url.parse(req.url).pathname;
        // // 获得对应的本地文件路径，类似 '/srv/www/css/bootstrap.css':
        let filepath = path.join(root, pathname);
        // // 获取文件状态:
        fs.stat(filepath, (err, stats) => {
            if (!err && stats.isFile()) {
                // 没有出错并且文件存在:
                console.log('200 ' + req.url);
                // 发送200响应:
                res.writeHead(200);
                // 将文件流导向response:
                fs.createReadStream(filepath).pipe(res);
            } else {
                // 出错了或者文件不存在:
                console.log('404 ' + req.url);
                // 发送404响应:
                res.writeHead(404);
                res.end('404 Not Found');
            }
        });
    }
}).listen(3000, () => {
    console.log("Listening at 3000 port");
})