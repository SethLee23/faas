// =======================
// 公共配置（不含用户名密码）
// =======================
const CONFIG = {
    // 基础地址
    BASE: $.argv.baseUrl,

    // 路径配置
    paths: {
        loginPage: '/manager/login/pages/loginPage.jsf',
        changePasswordPage: '/manager/pages/administrators/currentAdminAccount.jsf',
        mainFrame: '/manager/mainFrame.jsf'
    },

    // JSF 表单 ID
    forms: {
        login: 'loginForm',
        changePassword: 'changePasswordForm'
    },

    // 语言相关
    language: 'en',

    // 日志相关配置
    log: {
        responseSnippetLen: 600, // POST 响应体截断长度，防止日志过大
        enableMask: false        // 默认不脱敏；需要时调成 true
    }
};

// =======================
// 日志工具
// =======================

function logInfo(tag, msg, extra) {
    if (extra !== undefined) {
        $.ctx.trace.log?.(`[FORCEPOINT ${tag}] ${msg}`, extra);
    } else {
        $.ctx.trace.log?.(`[FORCEPOINT ${tag}] ${msg}`);
    }
}

function logDebug(tag, msg, extra) {
    if (extra !== undefined) {
        $.ctx.trace.debug?.(1, `[FORCEPOINT ${tag}] ${msg}`, extra);
    } else {
        $.ctx.trace.debug?.(1, `[FORCEPOINT ${tag}] ${msg}`);
    }
}

// =======================
// 工具函数区域
// =======================

function safeJson(obj) {
    try {
        return JSON.stringify(obj);
    } catch (e) {
        return "[unserializable:" + e.message + "]";
    }
}

function truncate(str, len) {
    if (!str) return '';
    if (str.length <= len) return str;
    return str.slice(0, len) + '...<truncated>';
}

// 对 body 做简单脱敏，避免密码打进日志
function maskSensitiveInBody(body) {
    if (!body) return body;
    if (!CONFIG.log.enableMask) return body; // 默认不脱敏，原样输出

    return body.replace(
        /(loginForm:idPassword|changePasswordForm:oldPassword|changePasswordForm:idPassword|changePasswordForm:idConfirmedPassword)=[^&]*/g,
        '$1=***'
    );
}

// 合并多次返回的 Set-Cookie，自动去重 + 覆盖
function mergeCookies(oldCookie, newSetCookie) {
    const cookieMap = {};

    // 解析旧 cookie
    if (oldCookie) {
        oldCookie.split(';').forEach(function (item) {
            const parts = item.split('=');
            const k = parts[0];
            const v = parts[1];
            if (k && v) cookieMap[k.trim()] = v.trim();
        });
    }

    // 解析新 Set-Cookie（数组）
    if (Array.isArray(newSetCookie)) {
        newSetCookie.forEach(function (str) {
            const pair = str.split(';')[0]; // 只取第一个 k=v
            const parts = pair.split('=');
            const k = parts[0];
            const v = parts[1];
            if (k && v) cookieMap[k.trim()] = v.trim(); // 覆盖旧值
        });
    }

    const merged = Object.keys(cookieMap)
        .map(function (k) { return k + '=' + cookieMap[k]; })
        .join('; ');

    logDebug('mergeCookies', 'merged cookie info', {
        oldLen: oldCookie ? oldCookie.length : 0,
        newCount: Array.isArray(newSetCookie) ? newSetCookie.length : 0,
        resultLen: merged.length
    });

    return merged;
}

function extractForm(html, formId) {
    if (!html) return '';
    const safeId = formId.replace(/[-[\]/{}()*+?.\\^$|]/g, '\\$&');
    // 精确匹配：<form ... id="xxx" ...> ... </form>
    const reg = new RegExp(
        '<form[^>]*id="' + safeId + '"[^>]*>[\\s\\S]*?<\\/form>',
        'i'
    );
    const m = reg.exec(html);
    logDebug('extractForm', 'match form', { formId, matched: !!m });
    return m ? m[0] : '';
}

// 从指定 HTML 片段中抽取某个 input 的 value
function extractInputValue(html, name) {
    if (!html) return '';
    const safeName = name.replace(/[-[\]/{}()*+?.\\^$|]/g, '\\$&');
    const reg = new RegExp('name="' + safeName + '"[^>]*value="([^"]*)"', 'i');
    const m = reg.exec(html);
    logDebug('extractInputValue', 'extract input', { name, found: !!m });
    return m ? m[1] : '';
}

// =======================
// 登录封装：提供给其他 FaaS 复用
// =======================

async function login({ account, password }) {
    const BASE = CONFIG.BASE;
    const paths = CONFIG.paths;
    const forms = CONFIG.forms;

    logInfo('LOGIN_INIT', 'start login in tool faas', { account });

    // ---------- Step1：GET 登录页 ----------
    const loginPageUrl = BASE + paths.loginPage;

    logInfo('LOGIN_STEP1', 'GET login page', { url: loginPageUrl });

    const loginPageRes = await $.http.get({
        url: loginPageUrl
    });

    if (loginPageRes.err) {
        logInfo('LOGIN_ERROR', '获取登录页失败', { err: loginPageRes.err.message });
        return {
            success: false,
            message: '获取登录页失败：' + loginPageRes.err.message
        };
    }

    // 初始 Cookie
    let cookies = mergeCookies(
        '',
        (loginPageRes.headers && loginPageRes.headers['set-cookie']) || []
    );
    logInfo('LOGIN_STEP1', 'initial cookies', { length: cookies.length });

    const loginPageHtml = loginPageRes.data || '';
    logDebug('LOGIN_STEP1', 'loginPageHtml length', { length: loginPageHtml.length });

    // 精确截取 loginForm 这一个 form（页面有多个 form）
    const loginFormHtml = extractForm(loginPageHtml, forms.login);

    if (!loginFormHtml) {
        logInfo('LOGIN_ERROR', '未在登录页中找到 loginForm 表单');
        return {
            success: false,
            message: '未在登录页中找到 loginForm 表单'
        };
    }

    logDebug('LOGIN_STEP1', 'loginFormHtml length', { length: loginFormHtml.length, });

    // 登录需要用到的关键字段
    const loginViewState = extractInputValue(loginFormHtml, 'javax.faces.ViewState');
    const s1=`id="javax.faces.ViewState" value="`
    const loginReturnUrl = extractInputValue(loginFormHtml, 'loginForm:idReturnUrl') || '';
    const loginButtonValue = extractInputValue(loginFormHtml, 'loginForm:idLoginButton') || 'Log On';
    const loginSubmitValue = extractInputValue(loginFormHtml, 'loginForm_SUBMIT') || '1';

    logDebug('LOGIN_STEP1', 'loginForm parsed fields', {
        loginViewStateExists: !!loginViewState,
        loginViewState,
        loginReturnUrl,
        loginButtonValue,
        loginSubmitValue
    });

    if (!loginViewState) {
        logInfo('LOGIN_ERROR', '未能从登录页解析 javax.faces.ViewState');
        return {
            success: false,
            message: '未能从登录页解析 javax.faces.ViewState'
        };
    }

    // ---------- Step2：POST 登录 ----------
    logInfo('LOGIN_STEP2', 'POST login', { url: loginPageUrl });
    const originBody = {
        'loginForm:idReturnUrl': loginReturnUrl,
        'loginForm:idUserName': account || $.argv.username,
        'loginForm:idPassword': password || $.argv.password,
        'autoScroll': '0,0',                    // 抓包为 0,0
        'loginForm:idLoginButton': loginButtonValue,
        'loginForm_SUBMIT': loginSubmitValue,   // 一般为 1
        'javax.faces.ViewState': loginViewState
    }
const loginBody = new URLSearchParams(originBody).toString();
    logDebug('LOGIN_STEP2', 'REQ', {
        headers: {
            //  'Content-Type': 'application/x-www-form-urlencoded',
            'Referer': loginPageUrl,
            Cookie: cookies,
            Origin: BASE,
            Host: $.argv.host
        },
        body: originBody
    });

    let h = `Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7
Accept-Encoding: gzip, deflate, br, zstd
Accept-Language: en-US,en;q=0.9,zh-TW;q=0.8,zh;q=0.7
Cache-Control: no-cache
Connection: keep-alive
Content-Type: application/x-www-form-urlencoded
Host: pxmwfa02:9443
Origin: https://pxmwfa02:9443
Pragma: no-cache
Referer: https://pxmwfa02:9443/manager/login/pages/loginPage.jsf
Sec-Fetch-Dest: document
Sec-Fetch-Mode: navigate
Sec-Fetch-Site: same-origin
Sec-Fetch-User: ?1
Upgrade-Insecure-Requests: 1
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36
sec-ch-ua: "Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"
sec-ch-ua-mobile: ?0
sec-ch-ua-platform: "Windows"`
let a = h.split('\n')
let m = {}
a.forEach(i  => {
    const  [k, v] = i.split(': ')
    m[k.trim()] = v.trim()
})

    const loginRes = await $.http.post(loginPageUrl, {
        maxRedirects: 0,
        validateStatus: status => status >= 200 && status < 400,
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            // 'Referer': loginPageUrl,
           // Cookie: cookies,
            //  Origin:  BASE,
            //Host: $.argv.host
            accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
            referer: "https://pxmwfa02:9443/manager/login/pages/loginPage.jsf",

            host: "pxmwfa02:9443",
            origin: "https://pxmwfa02:9443",
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
            ...m
        },
        data: loginBody
    });

    if (loginRes.err) {
        logInfo('LOGIN_ERROR', '登录请求失败', { err: loginRes.err.message || loginRes.err });
        return {
            success: false,
            message: '登录请求失败：' + (loginRes.err.message || loginRes.err)
        };
    }

    logDebug('LOGIN_STEP2', 'RESP', {
        status: loginRes.status,
        headers: {
            'set-cookie': loginRes.headers && loginRes.headers['set-cookie'],
            'content-type': loginRes.headers && loginRes.headers['content-type'],
            ...(loginRes.headers || {})
        },


        config: loginRes.response.config?.headers,

        // bodySnippet: truncate(String(loginRes.data || ''), CONFIG.log.responseSnippetLen)
    });

    // 合并登录返回的 Cookie（JSESSIONID 等）
    cookies = mergeCookies(
        cookies,
        (loginRes.headers && loginRes.headers['set-cookie']) || []
    );
    logInfo('LOGIN_STEP2', 'cookies after login', { length: cookies.length });

    return {
        success: true,
        cookies
    };
}

// =======================
// 向其他 FaaS 暴露工具函数
// =======================

$.ctx.FORCEPOINT = {
    CONFIG,
    logInfo,
    logDebug,
    safeJson,
    truncate,
    maskSensitiveInBody,
    mergeCookies,
    extractForm,
    extractInputValue,
    login
};