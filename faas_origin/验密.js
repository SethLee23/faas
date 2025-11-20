// get/post /api/user/check
const {
    login
} = $.ctx.FORCEPOINT || {};

const loginResult =await login({account: $.ctx.body.username, password: $.ctx.body.password});

if (!loginResult || !loginResult.success) {
    const msg = (loginResult && loginResult.message) || '登录失败';
    logInfo('ERROR', 'login failed in tool FaaS', { msg });
    return $.ctx.error(msg, 500);
}

return { ok: loginResult.success, msg:  loginResult.message }