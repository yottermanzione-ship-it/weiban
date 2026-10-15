import { useState } from 'react';
import { useChat } from '../app/chat.js';
import { MenuRow } from './shell-kit.js';
import { Dialog, showToast } from './toast.js';
export function HistoryRecoveryRow() {
  const chat=useChat();
  const [open,setOpen]=useState(false);
  const [pending,setPending]=useState(false);
  const [error,setError]=useState('');
  async function restore(){if(pending)return;setPending(true);setError('');try{await chat.restoreHistory();setOpen(false);showToast('聊天记录已恢复',2000,'success')}catch{setError('恢复暂未完成，请联网后重试')}finally{setPending(false)}}
  return <><MenuRow label="聊天记录恢复" disabled={pending} onClick={()=>{setError('');setOpen(true)}} />
    {open && <Dialog actions={[{label:'取消',onClick:()=>{if(!pending)setOpen(false)}},{label:pending?'恢复中…':'恢复',primary:true,onClick:()=>void restore()}]}><p>恢复聊天记录？</p>{error&&<p role="alert" className="error">{error}</p>}</Dialog>}</>;
}
