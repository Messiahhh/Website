const http = require("http"),
      fs = require("fs"),
      url = require('url'),
      path = require('path'),
      mime = require('mime'),
      ejs = require('ejs'),
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


http.createServer((req, res) => {
    //先根据不同请求方法封装对应的函数，挂载于req, res上

    //把请求方法转成小写
    req.method = req.method.toLowerCase();

    //获取请求实体，挂载于req.body
    const getBody = (callback) => {
        let obj = {},
            segment = [];
        req.on('data', (chunk) => {
            segment.push(chunk);
        })
        req.on('end', () => {
            segment = Buffer.concat(segment).toString();
            req.body = !segment ? obj : parseSeria({
                str: segment
            });
            callback();
        })
    }

    //获取查询字符串并挂载于req.query
    req.query = qs.parse(url.parse(req.url).query);
    
    //挂载cookie
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

    

    // res.render = (file) => {
    //     fs.readFile(file, (err, data) => {
    //         res.writeHead(200, {
    //             'Content-type': 'text/html',
    //         })
    //         res.write(data);
    //         res.end();
    //     })
    // }

    res.render = (file, obj) => {
        fs.readFile(file, 'utf-8', (err, data) => {
            let html = data;
            if (mime.lookup(file) !== 'text/html') {
                html = ejs.render(data, obj);
            }
            res.writeHead(200, {
                'Content-type': 'text/html',
            })
            res.write(html);
            res.end();
        })
    }

    //flag默认为1，此时没有id跳转/index
    //flag为0时，没有id则返回登录页面
    const checkId = ({
        flag = 1,
        callback
    }) => {
        let id = req.cookies[key];
        if (!id) {
            if (flag) {
                res.redirect('/index');
            }
            else {
                res.render('loginPage.html');
            }
        }
        else {
            client.hgetall(id, (err, data) => {
                if (err) {
                    console.log(err);
                }
                else {
                    if (data) {
                        callback(data);
                    }
                    else {
                        if (flag) {
                            res.redirect('/index');                        
                        }
                        else {
                            res.render('loginPage.html');
                        }
                    }
                }
            })
        }
    }
    //session存于内存中，已弃用
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
        user_id,
    }) => {
        let key = dateNow();
        client.hset(key, 'id', key);
        client.hset(key, 'usr', usr);
        client.hset(key, 'user_id', user_id);
        client.expire(key, 20 * 60);
        return {
            id: key,
            usr: usr,
            user_id: user_id
        }
    }
    
    


    //----------------页面路由
    

    // index --- 登录页面
    if (req.url === '/index') {
        checkId({
            flag: 0,
            callback: () => {
                res.redirect('/');
            }
        })
    }
    else if (req.url === '/') {
        checkId({
            callback: () => {
                res.render('index.html');                
            }
        })
    }
    else if(req.url === '/comment') {
        checkId({
            callback: (message) => {
                conn.query('SELECT * FROM comment WHERE display = 1', (err, data) => {
                    res.render('comment.ejs', {username: message.usr, data: data});
                })
            }
        })    
    }

    


    //----------------------------逻辑路由
    else if (req.url === '/delete') {
        checkId({
            callback: (message) => {
                getBody(() => {
                    let floor_id = req.body.floorId;
                    conn.query('UPDATE comment SET display = 0 WHERE floor_id = ?', [ floor_id], (err) => {
                        if (err) {
                            console.log(err);
                        }
                        else {
                            res.json({
                                status: 1
                            })
                        }
                    })
                })
            }
        })
    }
    else if (req.url === '/write') {
        checkId({
            callback: (message) => {
                getBody(() => {
                    let comment = req.body.comment,
                        user_id = message.user_id,
                        user = message.usr;
                    conn.query('INSERT INTO comment VALUE(?, ?, ?, ?, default)', [null, user_id, user, comment], (err) => {
                        if (err) {
                            console.log(err);
                        }
                        else {
                            res.json({
                                status: 1,
                            })
                        }
                    })
                })
            }
        })
    }
    // login --- 登录路由
    else if (req.url === '/login') {
        getBody(() => {
            let usr = req.body.usr,
                psd = req.body.psd;
            conn.query('SELECT * FROM user WHERE username = ? AND password = ?', [usr, psd], (err, data) => {
                if (err) {
                    console.log(err);
                }
                else if (data && data.length !== 0) {
                    req.session = generate({
                        usr: usr,
                        user_id: data[0]['user_id']
                    });
                    res.setHeader('Set-Cookie', serialize({
                            name: key,
                            val: req.session.id,
                            opt: {
                                expires: dateLater(dateNow(), expires),
                            }
                        })
                    )
                    res.json({
                        status: 1,
                        info: 'success'
                    })
                }
                else {
                    res.json({
                        status: 0,
                        info: "fail",
                    })
                }
            })
        })
    }
    //注册
    else if (req.url === '/reg') {
        getBody(() => {
            let usr = req.body.usr,
                psd = req.body.psd;
            conn.query('SELECT * FROM user WHERE username = ?', [usr], (err, data) => {
                if (err) {
                    console.log(err);
                }
                else {
                    if (data && data.length !== 0) {
                        res.json({
                            status: 0,
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
                                    status: 1,
                                    info: 'success'
                                })
                            }
                        })
                    }
                }
            })
        })
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