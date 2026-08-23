import { redirect } from 'next/navigation';

/** 首页重定向到监控台（数据集列表） */
export default function HomePage() {
  redirect('/datasets');
}
