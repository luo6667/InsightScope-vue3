import { timingSafeEqual } from 'node:crypto';

import { NextRequest, NextResponse } from 'next/server';

/** 常数时间比较（与后端 server/src/utils/auth.ts 的 safeEqual 一致,防时序侧信道） */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * 服务端访问控制(proxy,Next 16 中 middleware 的新约定)：
 * - 拦截 /api/* 请求,校验 `Authorization: Bearer <token>`(与后端 requireAccessToken 同一套协议)；
 * - NEXT_ACCESS_TOKEN 需与后端 server 的 ACCESS_TOKEN 同值;未设置 = 开发模式放行
 *   (与后端 authRequired=false 逻辑一致)；
 * - 放行 /api/auth/status(探测接口,后端也在鉴权之前注册)；
 * - 校验失败返回与后端同结构的 401 JSON,前端 axios 拦截器会触发 AccessGate 锁定重输口令；
 * - 注意:proxy 运行在 Next 进程,变量在 next build 时内联,NEXT_ACCESS_TOKEN 需在构建时注入。
 */

export function proxy(req: NextRequest) {
  const expected = process.env.NEXT_ACCESS_TOKEN;
  if (!expected) return NextResponse.next(); // 开发模式,不启用认证

  const { pathname } = req.nextUrl;
  if (pathname === '/api/auth/status') return NextResponse.next();

  const header = req.headers.get('authorization') ?? '';
  const presented = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  // 常数时间比较(与后端 timingSafeEqual 行为对齐),长度不同直接 false
  if (presented && safeEqual(presented, expected)) {
    return NextResponse.next();
  }
  return NextResponse.json({ error: '未授权：需要访问口令（ACCESS_TOKEN）' }, { status: 401 });
}

export const config = {
  matcher: ['/api/:path*'],
};
