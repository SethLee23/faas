// post /api/changePassword
// 从请求体拿参数
const { username, password: oldPassword, newPassword } = $.ctx.body || {};

// 从工具函数 FaaS 注入的变量里拿公共方法
const {
    CONFIG,
    logInfo,
    logDebug,
    maskSensitiveInBody,
    mergeCookies,
    extractForm,
    extractInputValue,
    login
} = $.ctx.FORCEPOINT || {};

if (!login || !CONFIG) {
    // 工具 FaaS 没有先加载 / 注入
    return $.ctx.error('工具函数 FaaS 未注入：缺少 login / CONFIG，请先部署并在网关链路中引入工具 FaaS', 500);
}

// =======================
// 业务配置（只负责本次请求相关）
// =======================

const BASE = CONFIG.BASE;
const paths = CONFIG.paths;
const forms = CONFIG.forms;

// 账号密码配置：仍然允许 body 为空时走默认值（方便测试）
const creds = {
    account: username ||  $.argv.username,
    oldPassword: oldPassword || $.argv.password,     // 旧密码
    newPassword: newPassword || '1234567__'     // 新密码（与确认密码保持一致）
};

logInfo('INIT', 'CONFIG loaded from tool FaaS');
logInfo('FLOW', 'Start login + change password');
logDebug('FLOW', 'basic config', CONFIG, { BASE, account: creds.account });

// =======================
// 调用公共 login，拿到 cookies
// =======================

const loginResult = await login({
    account: creds.account,
    password: creds.oldPassword
});

if (!loginResult || !loginResult.success) {
    const msg = (loginResult && loginResult.message) || '登录失败';
    logInfo('ERROR', 'login failed in tool FaaS', { msg });
    return $.ctx.error(msg, 500);
}

let cookies = loginResult.cookies;
logInfo('FLOW', 'cookies from login', { length: cookies.length });

// =======================
// Step 3：GET 修改密码页
// =======================

const changePageGetUrl = BASE + paths.changePasswordPage + '?pageId=myAccountPage';

logInfo('STEP3', 'GET change password page', { url: changePageGetUrl });

const changePageRes = await $.http.get(changePageGetUrl, {
    headers: {
        Cookie: cookies,
        Referer: BASE + paths.mainFrame
    }
});

if (changePageRes.err) {
    logInfo('ERROR', '获取修改密码页失败', { err: changePageRes.err.message });
    return $.ctx.error('获取修改密码页失败：' + changePageRes.err.message, 500);
}

// 继续合并可能返回的新 Cookie
cookies = mergeCookies(
    cookies,
    (changePageRes.headers && changePageRes.headers['set-cookie']) || []
);
logInfo('STEP3', 'cookies after changePage', { length: cookies.length });

const changeHtml = changePageRes.data || '';
logDebug('STEP3', 'changeHtml length', { length: changeHtml.length });

// 精确截取 changePasswordForm 表单
const changeFormHtml = extractForm(changeHtml, forms.changePassword);

if (!changeFormHtml) {
    logInfo('ERROR', '未在修改密码页中找到 changePasswordForm 表单');
    // return $.ctx.error(changeHtml, 500);
     
$.ctx.html(changeHtml, 200);  
  // return $.ctx.error('未在修改密码页中找到 changePasswordForm 表单', 500);
}

logDebug('STEP3', 'changeFormHtml length', { length: changeFormHtml.length });

// 抽取 form action（带那段 acf7xxxxx 的动态路径）
let changeFormAction = paths.changePasswordPage;
const actionMatch = /action="([^"]+)"/i.exec(changeFormHtml);
if (actionMatch && actionMatch[1]) {
    changeFormAction = actionMatch[1]; // 原样使用页面里的 action
}
const changePostUrl = BASE + changeFormAction;

logDebug('STEP3', 'change form action', {
    changeFormAction,
    changePostUrl
});

// 抽取 ViewState + SUBMIT
const changeViewState = extractInputValue(changeFormHtml, 'javax.faces.ViewState');
const changeSubmitValue = extractInputValue(changeFormHtml, 'changePasswordForm_SUBMIT') || '1';

logDebug('STEP3', 'change form fields', {
    changeViewStateExists: !!changeViewState,
    changeSubmitValue
});

if (!changeViewState) {
    logInfo('ERROR', '未能从修改密码页解析 javax.faces.ViewState');
    return $.ctx.error('未能从修改密码页解析 javax.faces.ViewState', 500);
}

// =======================
// Step 4：POST 修改密码
// =======================

logInfo('STEP4', 'POST change password', { url: changePostUrl });

const changeBody = new URLSearchParams({
    'changePasswordForm:oldPassword': creds.oldPassword,
    'changePasswordForm:idPassword': creds.newPassword,
    'changePasswordForm:idConfirmedPassword': creds.newPassword,
    'changePasswordForm:idLanguageSelect': CONFIG.language,
    'autoScroll': '0,0',
    'changePasswordForm_SUBMIT': changeSubmitValue,
    'javax.faces.ViewState': changeViewState,
    'changePasswordForm:_idcl': 'changePasswordForm:idActionApply'
}).toString();

logDebug('STEP4', 'REQ', {
    headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: cookies,
        Referer: changePageGetUrl
    },
    body: maskSensitiveInBody(changeBody)
});
  let h = `Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7
Accept-Encoding: gzip, deflate, br, zstd
Accept-Language: zh-TW,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6
Cache-Control: no-cache
Connection: keep-alive
Content-Type: application/x-www-form-urlencoded
Host: pxmwfa02:9443
Origin: https://pxmwfa02:9443
Pragma: no-cache
Referer: https://pxmwfa02:9443/manager/pages/administrators/currentAdminAccount.jsf?pageId=myAccountPage
Sec-Fetch-Dest: iframe
Sec-Fetch-Mode: navigate
Sec-Fetch-Site: same-origin
Sec-Fetch-User: ?1
Upgrade-Insecure-Requests: 1
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0
sec-ch-ua: "Microsoft Edge";v="141", "Not?A_Brand";v="8", "Chromium";v="141"
sec-ch-ua-mobile: ?0
sec-ch-ua-platform: "Windows"`
let a = h.split('\n')
let m = {}
a.forEach(i  => {
    const  [k, v] = i.split(': ')
    m[k.trim()] = v.trim()
})

const changeRes = await $.http.post(changePostUrl, {
     maxRedirects: 0,
     validateStatus: status => status >= 200 && status < 400,
    headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: cookies,
        Referer: changePageGetUrl,
        ...m
    },
    data: changeBody
});

if (changeRes.err) {
    logInfo('ERROR', '修改密码请求失败', {
        url: changePostUrl,
        err: changeRes.err.message || changeRes.err
    });
    return $.ctx.error('修改密码请求失败：' + changePostUrl + (changeRes.err.message || changeRes.err), 500);
}

logDebug('STEP4', 'RESP', {
    status: changeRes.status,
    headers: {
        'set-cookie': changeRes.headers && changeRes.headers['set-cookie'],
        'content-type': changeRes.headers && changeRes.headers['content-type']
    }
    // bodySnippet: truncate(String(changeRes.data || ''), CONFIG.log.responseSnippetLen)
});

// =======================
// 收尾
// =======================

logInfo('DONE', 'login + change password flow finished (with tool FaaS)');

$.ctx.json(
    {
        ok: true,
        msg: '修改密码流程执行完成'
    },
    200
)

