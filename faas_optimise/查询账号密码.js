// /api/account/list
// /api/account/list
const {
  login,
  CONFIG,
  logInfo,
  logDebug,
  httpRequest,
  parseAdminList
} = $.ctx.FORCEPOINT || {};

async function main() {
  // 1. 登录
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

  // 2. 拉取 adminList 页面（路径 + pageId 都从 CONFIG 里拿）
  const adminListUrl =
    CONFIG.BASE +
    CONFIG.paths.adminListPage +
    '?pageId=' +
    (CONFIG.pages && CONFIG.pages.adminListPageId
      ? CONFIG.pages.adminListPageId
      : 'administratorsListPage');

  const adminListRes = await httpRequest({
    method: 'GET',
    url: adminListUrl,
    cookies,
    headers: {
      Referer: CONFIG.BASE + CONFIG.paths.mainFrame
    }
  });

  if (adminListRes && adminListRes.err) {
    logInfo('ADMIN_LIST_ERROR', 'GET adminList failed', {
      err: adminListRes.err.message || adminListRes.err
    });
    return $.ctx.error(
      '获取账户列表失败：' +
      (adminListRes.err.message || adminListRes.err),
      500
    );
  }

  cookies = (adminListRes && adminListRes.cookies) || cookies;

  const adminListHtml = (adminListRes && adminListRes.data) || '';
  logDebug('ADMIN_LIST_HTML', 'adminListHtml length', {
    length: String(adminListHtml).length
  });

  // 解析列表（调用公共 parseAdminList）
  const list = parseAdminList(adminListHtml);
  logDebug('ADMIN_LIST_STEP1', 'parse adminList done', { total: list.length });

  // ===== 严格按【名称+邮箱】去重 =====
  const dedupMap = new Map(); // key: name + '||' + email

  for (const item of list) {
    const user_name = (item.name || '').trim();
    const email = (item.email || '').trim();

    const key = user_name + '||' + email;

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

  return $.ctx.json(dedupedList);
}

return main();
