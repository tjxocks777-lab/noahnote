// 매 정시(UTC)마다 실행: 알림 시각이 된 사용자 중 오늘 아직 복습하지 않은 사람에게 알림을 보낸다.
import { runDue } from '../lib/push-lib.mjs';
export default async () => { const r = await runDue(); return new Response(JSON.stringify(r)); };
export const config = { schedule: '0 * * * *' };
