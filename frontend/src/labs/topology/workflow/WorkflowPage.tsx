import PageHeader from '../../../components/PageHeader'
import Card from '../../../components/Card'
import { WorkflowEditor } from './WorkflowEditor'

export default function WorkflowPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="采集管线工作台"
        description="xyops 节点体系（trigger / event / job / action / limit / controller / note）的 React Flow 编辑器。拖左侧节点入画布，连 handle 建线，选中按 Del 删除。节点轮子直接拿来，画布/连线/缩放/拖拽用 React Flow 自带件。"
      />
      <Card padding={false} className="overflow-hidden border-white/10 bg-[#060606]">
        <div className="h-[70vh] min-h-[540px] bg-black">
          <WorkflowEditor />
        </div>
      </Card>
    </div>
  )
}
