// /api/account/list
const {
    login,
    CONFIG,
    logInfo,
    logDebug,
    mergeCookies
  } = $.ctx.FORCEPOINT || {};
  
  function decodeHtmlEntities(str) {
    if (!str) return '';
    return str
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)));
  }
  
  function stripTags(str) {
    if (!str) return '';
    return str.replace(/<[^>]+>/g, '');
  }
  
  // 关键解析逻辑：基于组件 id 规则
  function parseAdminList(html) {
    if (!html) return [];
  
    const rows = [];
    const emailRe = /id="adminList:idDataTableAdmins:(\d+):outEmailAddress"[^>]*>([^<]*)</g;
    let m;
  
    while ((m = emailRe.exec(html)) !== null) {
      const index = m[1];
      const emailRaw = (m[2] || '').trim();
      const email = decodeHtmlEntities(emailRaw);
  
      const nameRe = new RegExp(
        'id="adminList:idDataTableAdmins:' + index + ':editAdminLink"[\\s\\S]*?>([\\s\\S]*?)<\\/a>',
        'i'
      );
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
  
  async function main() {
    // 1. 登录（复用你现有的 login 工具）
    const loginResult = await login({
      account: $.ctx.body.username,
      password: $.ctx.body.password
    });
  
    if (!loginResult || !loginResult.success) {
      const msg = (loginResult && loginResult.message) || '登录失败';
      logInfo('ADMIN_LIST_ERROR', 'login failed in list FaaS', { msg });
      return $.ctx.error(msg, 500);
    }
  
    let cookies = loginResult.cookies || '';
    logInfo('ADMIN_LIST_STEP1', 'login success, start fetch adminList', {
      cookieLen: cookies.length
    });
  
    // 2. 拉取 adminList 页面
    const adminListUrl = CONFIG.BASE + '/manager/pages/administrators/adminList.jsf?pageId=administratorsListPage';
  
    const adminListRes = await $.http.get({
      url: adminListUrl,
      headers: {
        Cookie: cookies,
        Referer: CONFIG.BASE + CONFIG.paths.mainFrame
      }
    });
  
    if (adminListRes.err) {
      logInfo('ADMIN_LIST_ERROR', 'GET adminList failed', {
        err: adminListRes.err.message || adminListRes.err
      });
      return $.ctx.error(
        '获取账户列表失败：' + (adminListRes.err.message || adminListRes.err),
        500
      );
    }
  
    cookies = mergeCookies(
      cookies,
      (adminListRes.headers && adminListRes.headers['set-cookie']) || []
    );
  
    const adminListHtml = adminListRes.data || '';
    logDebug('ADMIN_LIST_HTML', 'adminListHtml length', {
      length: String(adminListHtml).length
    });
  
    // 解析列表
    const list = parseAdminList(adminListHtml);
    logDebug('ADMIN_LIST_STEP1', 'parse adminList done', { total: list.length });
  
    // ===== 严格按【名称+邮箱】去重 =====
    const dedupMap = new Map(); // key: name + '||' + email，两个字段都一样才视为同一条
  
    for (const item of list) {
      const user_name = (item.name || '').trim();
      const email = (item.email || '').trim();
  
      const key = `${user_name}||${email}`; // 名称 + 邮箱 双字段组合 key
  
      if (!dedupMap.has(key)) {
        dedupMap.set(key, { user_name, email });
      }
    }
  
    const dedupedList = Array.from(dedupMap.values());
  
    logDebug('ADMIN_LIST_STEP1', 'dedup adminList done', {
      before: list.length,
      after: dedupedList.length
    });
    // =================================
  
    // 结构化输出
    return $.ctx.json(dedupedList);
  }
  
  return main();
  