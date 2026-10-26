/** 真实DataTable/批量确认组件，记录更新为本地合成回调，不访问生产API。 */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN.js';
import { DataTable } from '../../src/ui/table.js';
import { BatchStatusActions } from '../../src/ui/batch-status.js';
import '../../src/app/styles.css';
type Row = { id: string; name: string; enabled: boolean };
const calls: Array<{ id: string; enabled: boolean }> = [];
Object.assign(window, { batchCalls: calls });
function Fixture() {
  const [data, setData] = useState<Row[]>([
    { id: 'a', name: '记录A', enabled: true },
    { id: 'b', name: '记录B', enabled: true },
  ]);
  const [selected, setSelected] = useState<string[]>([]);
  const [opened, setOpened] = useState('');
  const readonly = new URLSearchParams(location.search).has('readonly');
  return (
    <>
      <output data-testid="opened">{opened}</output>
      <output data-testid="selected">{selected.join(',')}</output>
      <DataTable<Row>
        rowKey="id"
        columns={[
          { title: '名称', dataIndex: 'name' },
          { title: '状态', render: (_, row) => (row.enabled ? '启用' : '停用') },
        ]}
        data={data}
        pagination={false}
        onRowClick={(row) => setOpened(row.id)}
        {...(readonly
          ? {}
          : {
              selectedKeys: selected,
              onSelectionChange: (keys: Array<string | number | bigint>) =>
                setSelected(keys.map(String)),
              batchActions: (rows: Row[]) => (
                <BatchStatusActions
                  rows={rows}
                  name="测试记录"
                  keyOf={(row) => row.id}
                  labelOf={(row) => row.name}
                  update={async (row, enabled) => {
                    calls.push({ id: row.id, enabled });
                    if (row.id === 'b') throw new Error('模拟权限拒绝');
                    setData((before) =>
                      before.map((item) => (item.id === row.id ? { ...item, enabled } : item)),
                    );
                  }}
                  onComplete={setSelected}
                />
              ),
            })}
      />
    </>
  );
}
createRoot(document.getElementById('root')!).render(
  <ConfigProvider locale={zhCN}>
    <App>
      <Fixture />
    </App>
  </ConfigProvider>,
);
