import { Navigate } from 'react-router-dom';
/** 旧榜单链接归并到同一模型页。 */
export function LeaderboardPage() {
  return <Navigate to="/models/scenario/chat" replace />;
}
