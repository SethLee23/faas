// post /api/changePassword
// 从请求体拿参数
// post /api/changePassword
// 从请求体拿参数
const { username, password: oldPassword, newPassword } = $.ctx.body || {};

// 从工具函数 FaaS 注入的变量里拿公共方法
const {
  CONFIG,
  logInfo,
  logDebug,
  maskSensitiveInBody,
  extractForm,
  extractInputValue,
  httpRequest,
  login,
} = $.ctx.FORCEPOINT || {};

if (!login || !CONFIG) {
  return $.ctx.error("工具函数 FaaS 未注入：缺少 login 或 CONFIG", 500);
}

// =======================
// 入参必填校验：用户名 / 旧密码 / 新密码
// =======================

if (!username || !oldPassword || !newPassword) {
  return $.ctx.error(
    "缺少必要参数：username、password、newPassword 均为必填",
    500
  );
}

// =======================
// 业务配置（只负责本次请求相关）
// =======================

const BASE = CONFIG.BASE;
const paths = CONFIG.paths;
const forms = CONFIG.forms;
const pages = CONFIG.pages || {};

const creds = {
  account: username,
  oldPassword: oldPassword,
  newPassword: newPassword,
};

logInfo("INIT", "CONFIG loaded from tool FaaS");
logInfo("FLOW", "Start login + change password");
logDebug("FLOW", "basic config", { BASE, account: creds.account });

// =======================
// 调用公共 login，拿到 cookies
// =======================

const loginResult = await login({
  account: creds.account,
  password: creds.oldPassword,
});

if (!loginResult || !loginResult.success) {
  const msg = (loginResult && loginResult.message) || "登录失败";
  logInfo("ERROR", "login failed in tool FaaS", { msg });
  return $.ctx.error(msg, 500);
}

let cookies = loginResult.cookies;
logInfo("FLOW", "cookies from login", { length: cookies.length });

// =======================
// Step 3：GET 修改密码页
// =======================

const changePageGetUrl =
  BASE +
  paths.changePasswordPage +
  "?pageId=" +
  (pages.changePasswordPageId || "myAccountPage");

logInfo("STEP3", "GET change password page", { url: changePageGetUrl });

const changePageRes = await httpRequest({
  method: "GET",
  url: changePageGetUrl,
  cookies,
  headers: {
    Referer: BASE + paths.mainFrame,
  },
});

if (changePageRes && changePageRes.err) {
  logInfo("ERROR", "获取修改密码页失败", {
    err: changePageRes.err.message || changePageRes.err,
  });
  return $.ctx.error(
    "获取修改密码页失败：" + (changePageRes.err.message || changePageRes.err),
    500
  );
}

// 合并 Cookie（httpRequest 已自动 merge）
cookies = (changePageRes && changePageRes.cookies) || cookies;
logInfo("STEP3", "cookies after changePage", { length: cookies.length });

const changeHtml = (changePageRes && changePageRes.data) || "";
logDebug("STEP3", "changeHtml length", { length: String(changeHtml).length });

// 精确截取 changePasswordForm 表单
const changeFormHtml = extractForm(changeHtml, forms.changePassword);

if (!changeFormHtml) {
  logInfo("ERROR", "未在修改密码页中找到 changePasswordForm 表单");
  return $.ctx.html(changeHtml, 200); // 直出页面方便排查
}

// 抽取 ViewState + SUBMIT
const changeViewState = extractInputValue(
  changeFormHtml,
  "javax.faces.ViewState"
);
const changeSubmitValue =
  extractInputValue(changeFormHtml, "changePasswordForm_SUBMIT") || "1";

logDebug("STEP3", "change form fields", {
  changeViewStateExists: !!changeViewState,
  changeSubmitValue,
});

if (!changeViewState) {
  logInfo("ERROR", "未能从修改密码页解析 javax.faces.ViewState");
  return $.ctx.error("未能从修改密码页解析 javax.faces.ViewState", 500);
}

// 抽取表单 action（带 acf7xxxxx 的动态路径）
let changeFormAction = paths.changePasswordPage;
const actionReg = new RegExp('action="([^"]+)"', "i");
const actionMatch = actionReg.exec(changeFormHtml);
if (actionMatch && actionMatch[1]) {
  changeFormAction = actionMatch[1];
}
const changePostUrl = BASE + changeFormAction;

logDebug("STEP3", "change form action", {
  changeFormAction,
  changePostUrl,
});

// =======================
// Step 4：POST 修改密码
// =======================

logInfo("STEP4", "POST change password", { url: changePostUrl });

const changeBody = new URLSearchParams({
  "changePasswordForm:oldPassword": creds.oldPassword,
  "changePasswordForm:idPassword": creds.newPassword,
  "changePasswordForm:idConfirmedPassword": creds.newPassword,
  "changePasswordForm:idLanguageSelect": CONFIG.language,
  autoScroll: "0,0",
  changePasswordForm_SUBMIT: changeSubmitValue,
  "javax.faces.ViewState": changeViewState,
  "changePasswordForm:_idcl": "changePasswordForm:idActionApply",
}).toString();

logDebug("STEP4", "REQ", {
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    Referer: changePageGetUrl,
  },
  cookiesLength: cookies.length,
  body: maskSensitiveInBody(changeBody),
});

const changeRes = await httpRequest({
  method: "POST",
  url: changePostUrl,
  cookies,
  data: changeBody,
  maxRedirects: 0,
  validateStatus: function (status) {
    return status >= 200 && status < 400;
  },
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    Referer: changePageGetUrl,
  },
});

if (changeRes && changeRes.err) {
  logInfo("ERROR", "修改密码请求失败", {
    err: changeRes.err.message || changeRes.err,
  });
  return $.ctx.error(
    "修改密码请求失败：" +
      changePostUrl +
      (changeRes.err.message || changeRes.err),
    500
  );
}

logDebug("STEP4", "RESP", {
  status: changeRes.status,
  headers: {
    "set-cookie": changeRes.headers && changeRes.headers["set-cookie"],
    "content-type": changeRes.headers && changeRes.headers["content-type"],
  },
  // bodySnippet: truncate(String(changeRes.data || ''), CONFIG.log.responseSnippetLen)
});

// =======================
// 结果判断：通过返回页面内容识别成功 / 失败
// 成功条件：if (true) + Password successfully changed... 组合
// 错误信息：id="pageErrorTableContainerTextPlaceTD" 下的 span 文本
// =======================

const changeHtmlStr = String((changeRes && changeRes.data) || "");

// 成功条件
const successFlag =
  changeHtmlStr.indexOf("if(true)") !== -1 &&
  changeHtmlStr.indexOf(
    "Password successfully changed. You will now be logged off."
  ) !== -1;

// 失败时解析页面错误信息
let changeErrorMsg = "";
try {
  const errPattern =
    'id="pageErrorTableContainerTextPlaceTD"[\\s\\S]*?<span[^>]*>([\\s\\S]*?)<\\/span>';
  const errReg = new RegExp(errPattern, "i");
  const errMatch = errReg.exec(changeHtmlStr);
  if (errMatch && errMatch[1]) {
    const tagReg = new RegExp("<[^>]+>", "g");
    const spaceReg = new RegExp("\\s+", "g");
    changeErrorMsg = errMatch[1]
      .replace(tagReg, "")
      .replace(spaceReg, " ")
      .trim();
  }
} catch (e) {
  logDebug("STEP4", "parse change password error failed", {
    err: e.message,
  });
}
if (!successFlag && changeErrorMsg) {
  const msg = changeErrorMsg || "修改密码失败：未检测到成功标识代码";
  logInfo("ERROR", "change password failed by page content", { msg });
  return $.ctx.error(msg, 500);
}

// =======================
// 收尾
// =======================

logInfo("DONE", "login + change password flow finished (with tool FaaS)");

$.ctx.json(
  {
    ok: true,
    msg: "修改密码流程执行完成",
  },
  200
);
