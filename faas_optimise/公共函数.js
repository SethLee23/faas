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
      adminListPage: '/manager/pages/administrators/adminList.jsf',
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
      responseSnippetLen: 600, // 响应体截断长度，防止日志过大
      enableMask: false        // 默认不脱敏；需要时调成 true
    },
  
    // 页面标识配置
    pages: {
      changePasswordPageId: $.argv.changePasswordPageId || 'myAccountPage',
      adminListPageId: $.argv.adminListPageId || 'administratorsListPage'
    },
  
    // HTTP 默认头配置（可按需扩展）
    http: {
      defaultHeaders: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0"
      }
    }
  };
  
  // 可选 header 注入：Host / User-Agent
  if ($.argv.host) {
    CONFIG.http.defaultHeaders.Host = $.argv.host;
  }
  if ($.argv.userAgent) {
    CONFIG.http.defaultHeaders['User-Agent'] = $.argv.userAgent;
  }
  
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
  // 通用工具函数
  // =======================
  
  function safeJson(obj) {
    try {
      return JSON.stringify(obj);
    } catch (e) {
      return '[unserializable:' + e.message + ']';
    }
  }
  
  function truncate(str, maxLen) {
    const s = String(str || '');
    if (!maxLen || s.length <= maxLen) return s;
    return s.slice(0, maxLen) + `... (truncated, total=${s.length})`;
  }
  
  // 对 body 做简单脱敏，避免密码打进日志
  function maskSensitiveInBody(body) {
    if (!body) return body;
    if (!CONFIG.log.enableMask) return body; // 默认不脱敏，原样输出
  
    const s = String(body);
    const reg = new RegExp(
      '(loginForm:idPassword|changePasswordForm:oldPassword|changePasswordForm:idPassword|changePasswordForm:idConfirmedPassword)=[^&]*',
      'g'
    );
    return s.replace(reg, '$1=***');
  }
  
  // =======================
  // Cookie 合并工具
  // =======================
  
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
      newSetCookie.forEach(function (setCookieStr) {
        const one = setCookieStr.split(';')[0];
        const parts = one.split('=');
        const k = parts[0];
        const v = parts[1];
        if (k && v) cookieMap[k.trim()] = v.trim();
      });
    }
  
    const merged = Object.keys(cookieMap)
      .map(function (k) {
        return k + '=' + cookieMap[k];
      })
      .join('; ');
  
    logDebug('mergeCookies', 'merged cookie info', {
      oldLen: oldCookie ? oldCookie.length : 0,
      newCount: Array.isArray(newSetCookie) ? newSetCookie.length : 0,
      resultLen: merged.length
    });
  
    return merged;
  }
  
  // =======================
  // HTML / 表单解析工具
  // =======================
  
  // 从整页 HTML 中精确截取某个 <form> 片段
  function extractForm(html, formId) {
    if (!html) return '';
    const safeId = formId.replace(/[-[\]/{}()*+?.\\^$|]/g, '\\$&');
    const pattern = '<form[^>]*id="' + safeId + '"[\\s\\S]*?<\\/form>';
    const reg = new RegExp(pattern, 'i');
    const m = reg.exec(html);
    logDebug('extractForm', 'extract form', { formId, found: !!m });
    return m ? m[0] : '';
  }
  
  // 从指定 HTML 片段中抽取某个 input 的 value
  function extractInputValue(html, name) {
    if (!html) return '';
    const safeName = name.replace(/[-[\]/{}()*+?.\\^$|]/g, '\\$&');
    const pattern = 'name="' + safeName + '"[^>]*value="([^"]*)"';
    const reg = new RegExp(pattern, 'i');
    const m = reg.exec(html);
    logDebug('extractInputValue', 'extract input', { name, found: !!m });
    return m ? m[1] : '';
  }
  
  // HTML 实体解码
  function decodeHtmlEntities(str) {
    if (!str) return '';
    return str
      .replace(new RegExp('&amp;', 'g'), '&')
      .replace(new RegExp('&lt;', 'g'), '<')
      .replace(new RegExp('&gt;', 'g'), '>')
      .replace(new RegExp('&quot;', 'g'), '"')
      .replace(new RegExp('&#39;', 'g'), "'")
      .replace(
        new RegExp('&#(\\d+);', 'g'),
        function (_, num) {
          return String.fromCharCode(parseInt(num, 10));
        }
      );
  }
  
  // 去掉简单的 HTML 标签
  function stripTags(str) {
    if (!str) return '';
    const reg = new RegExp('<[^>]+>', 'g');
    return str.replace(reg, '');
  }
  
  // 解析管理员列表页面中的账户数据（供 /api/account/list 使用）
  function parseAdminList(html) {
    if (!html) return [];
  
    const rows = [];
    const emailPattern =
      'id="adminList:idDataTableAdmins:(\\d+):outEmailAddress"[^>]*>([^<]*)<';
    const emailRe = new RegExp(emailPattern, 'g');
    let m;
  
    while ((m = emailRe.exec(html)) !== null) {
      const index = m[1];
      const emailRaw = (m[2] || '').trim();
      const email = decodeHtmlEntities(emailRaw);
  
      const namePattern =
        'id="adminList:idDataTableAdmins:' +
        index +
        ':editAdminLink"[\\s\\S]*?>([\\s\\S]*?)<\\/a>';
      const nameRe = new RegExp(namePattern, 'i');
      const nameMatch = nameRe.exec(html);
  
      let name = '';
      if (nameMatch) {
        const innerHtml = nameMatch[1] || '';
        name = decodeHtmlEntities(stripTags(innerHtml).trim());
      }
  
      rows.push({
        index: Number(index),
        name,
        email
      });
    }
  
    return rows;
  }
  
  // =======================
  // 封装带 Cookie 的 HTTP 请求（自动 mergeCookies + 默认头）
  // =======================
  
  async function httpRequest(options) {
    const {
      method = 'GET',
      url,
      cookies = '',
      data,
      headers = {},
      maxRedirects,
      validateStatus
    } = options || {};
  
    const upper = String(method).toUpperCase();
  
    const finalHeaders = Object.assign(
      {},
      CONFIG.http && CONFIG.http.defaultHeaders ? CONFIG.http.defaultHeaders : {},
      headers
    );
  
    if (cookies) {
      finalHeaders.Cookie = cookies;
    }
  
    const reqConfig = {
      headers: finalHeaders
    };
  
    if (typeof maxRedirects !== 'undefined') {
      reqConfig.maxRedirects = maxRedirects;
    }
    if (typeof validateStatus === 'function') {
      reqConfig.validateStatus = validateStatus;
    }
    if (upper === 'POST') {
      reqConfig.data = data;
    }
  
    let res;
    if (upper === 'GET') {
      res = await $.http.get(url, reqConfig);
    } else if (upper === 'POST') {
      res = await $.http.post(url, reqConfig);
    } else {
      throw new Error('Unsupported HTTP method: ' + method);
    }
  
    if (!res) return res;
  
    const setCookie = (res.headers && res.headers['set-cookie']) || [];
    const mergedCookies = mergeCookies(
      cookies,
      Array.isArray(setCookie) ? setCookie : []
    );
  
    return Object.assign({}, res, { cookies: mergedCookies });
  }
  
  // =======================
  // 登录封装：提供给其他 FaaS 复用
  // 登录成功条件：HTTP 302；否则从 loginForm:idGlobalErrorMessages 解析错误
  // =======================
  
  async function login({ account, password }) {
    const BASE = CONFIG.BASE;
    const paths = CONFIG.paths;
    const forms = CONFIG.forms;
  
    logInfo('LOGIN_INIT', 'start login in tool faas', { account });
  
    // ---------- Step1：GET 登录页 ----------
    const loginPageUrl = BASE + paths.loginPage;
  
    logInfo('LOGIN_STEP1', 'GET login page', { url: loginPageUrl });
  
    const loginPageRes = await httpRequest({
      method: 'GET',
      url: loginPageUrl,
      cookies: ''
    });
  
    if (loginPageRes && loginPageRes.err) {
      logInfo('LOGIN_ERROR', '获取登录页失败', {
        err: loginPageRes.err.message || loginPageRes.err
      });
      return {
        success: false,
        message:
          '获取登录页失败：' + (loginPageRes.err.message || loginPageRes.err)
      };
    }
  
    let cookies = (loginPageRes && loginPageRes.cookies) || '';
    logInfo('LOGIN_STEP1', 'initial cookies', { length: cookies.length });
  
    const loginPageHtml = (loginPageRes && loginPageRes.data) || '';
    logDebug('LOGIN_STEP1', 'loginPageHtml length', {
      length: String(loginPageHtml).length
    });
  
    // 精确截取 loginForm 这一个 form
    const loginFormHtml = extractForm(loginPageHtml, forms.login);
  
    if (!loginFormHtml) {
      logInfo('LOGIN_ERROR', '未在登录页中找到 loginForm 表单');
      return {
        success: false,
        message: '未在登录页中找到 loginForm 表单'
      };
    }
  
    logDebug('LOGIN_STEP1', 'loginFormHtml length', {
      length: String(loginFormHtml).length
    });
  
    // 登录需要用到的关键字段
    const loginViewState = extractInputValue(
      loginFormHtml,
      'javax.faces.ViewState'
    );
    const loginReturnUrl =
      extractInputValue(loginFormHtml, 'loginForm:idReturnUrl') || '';
    const loginButtonValue =
      extractInputValue(loginFormHtml, 'loginForm:idLoginButton') || 'Log On';
    const loginSubmitValue =
      extractInputValue(loginFormHtml, 'loginForm_SUBMIT') || '1';
  
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
      autoScroll: '0,0',
      'loginForm:idLoginButton': loginButtonValue,
      'loginForm_SUBMIT': loginSubmitValue,
      'javax.faces.ViewState': loginViewState
    };
    const loginBody = new URLSearchParams(originBody).toString();
  
    logDebug('LOGIN_STEP2', 'REQ', {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: loginPageUrl
      },
      body: originBody
    });
  
    const loginRes = await httpRequest({
      method: 'POST',
      url: loginPageUrl,
      cookies,
      data: loginBody,
      maxRedirects: 0,
      validateStatus: function (status) {
        return status >= 200 && status < 400;
      },
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: loginPageUrl
      }
    });
  
    if (loginRes && loginRes.err) {
      logInfo('LOGIN_ERROR', '登录请求失败', {
        err: loginRes.err.message || loginRes.err
      });
      return {
        success: false,
        message: '登录请求失败：' + (loginRes.err.message || loginRes.err)
      };
    }
  
    const loginStatus = loginRes.status;
    const loginHtmlStr = String(loginRes.data || '');
  
    logDebug('LOGIN_STEP2', 'RESP', {
      status: loginStatus,
      headers: {
        'set-cookie': loginRes.headers && loginRes.headers['set-cookie'],
        'content-type': loginRes.headers && loginRes.headers['content-type']
      }
      // bodySnippet: truncate(loginHtmlStr, CONFIG.log.responseSnippetLen)
    });
  
    // ===== 登录结果判断：只有 302 视为成功，其它状态尝试解析页面错误 =====
    if (loginStatus !== 302) {
      let globalErrorMsg = '';
  
      try {
        const errPattern =
          'id="loginForm:idGlobalErrorMessages"[\\s\\S]*?<span[^>]*>([\\s\\S]*?)<\\/span>';
        const errReg = new RegExp(errPattern, 'i');
        const errMatch = errReg.exec(loginHtmlStr);
        if (errMatch && errMatch[1]) {
          const tagReg = new RegExp('<[^>]+>', 'g');
          const spaceReg = new RegExp('\\s+', 'g');
          globalErrorMsg = errMatch[1]
            .replace(tagReg, '')
            .replace(spaceReg, ' ')
            .trim();
        }
      } catch (e) {
        logDebug('LOGIN_STEP2', 'parse login global error failed', {
          err: e.message
        });
      }
  
      if (!globalErrorMsg) {
        globalErrorMsg = '登录失败：状态码 ' + loginStatus;
      }
  
      logInfo('LOGIN_ERROR', 'login failed by status / page error', {
        status: loginStatus,
        message: globalErrorMsg
      });
  
      return {
        success: false,
        message: globalErrorMsg,
        status: loginStatus
      };
    }
  
    cookies = loginRes.cookies || cookies;
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
    decodeHtmlEntities,
    stripTags,
    parseAdminList,
    httpRequest,
    login
  };
  