"use client"

import { useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { FileArchive, Loader2, Upload } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  PLUGIN_CATALOG_QUERY_KEY,
  importDifyPluginPackage,
  type BackendPluginInstallation,
} from "@/lib/plugins/backend-plugin-catalog"

const MAX_PACKAGE_BYTES = 50 * 1024 * 1024

export function DifyPackageImportDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported?: (installation: BackendPluginInstallation) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const chooseFile = (next: File | undefined) => {
    if (!next) return
    if (next.size > MAX_PACKAGE_BYTES) {
      toast.error("插件包不能超过 50 MiB")
      return
    }
    if (!/\.(?:ya?ml|difypkg)$/i.test(next.name)) {
      toast.error("请选择 manifest.yaml、manifest.yml 或 .difypkg 文件")
      return
    }
    setFile(next)
  }

  const submit = async () => {
    if (!file || submitting) return
    setSubmitting(true)
    try {
      const installation = await importDifyPluginPackage(file)
      await queryClient.invalidateQueries({ queryKey: PLUGIN_CATALOG_QUERY_KEY })
      toast.success(`已导入 ${installation.providerKey} ${installation.version}`)
      setFile(null)
      onImported?.(installation)
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Dify 插件导入失败")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!submitting) onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>导入 Dify 插件包</DialogTitle>
          <DialogDescription>
            导入 manifest 或 .difypkg 的能力声明。系统只登记元数据，不执行包内代码。
          </DialogDescription>
        </DialogHeader>

        <input
          ref={inputRef}
          type="file"
          accept=".yaml,.yml,.difypkg,application/zip,application/x-yaml"
          className="sr-only"
          onChange={(event) => chooseFile(event.target.files?.[0])}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex min-h-36 w-full flex-col items-center justify-center rounded-lg border border-dashed p-5 text-center outline-none transition-colors hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {file ? (
            <>
              <FileArchive aria-hidden="true" className="size-7" />
              <span className="mt-3 max-w-full truncate text-sm font-medium">{file.name}</span>
              <span className="mt-1 text-xs text-muted-foreground">
                {(file.size / 1024).toFixed(1)} KiB · 点击重新选择
              </span>
            </>
          ) : (
            <>
              <Upload aria-hidden="true" className="size-7 text-muted-foreground" />
              <span className="mt-3 text-sm font-medium">选择本地插件包</span>
              <span className="mt-1 text-xs text-muted-foreground">
                manifest.yaml / manifest.yml / .difypkg，最大 50 MiB
              </span>
            </>
          )}
        </button>

        <div className="rounded-lg border bg-muted/20 p-3 text-xs leading-5 text-muted-foreground">
          第三方能力默认标记为 BLOCKED。只有安装了明确兼容的 OpenCLI 运行适配器后，
          对应节点才能执行；导入操作不会授予网络、模型或密钥权限。
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            取消
          </Button>
          <Button onClick={() => void submit()} disabled={!file || submitting}>
            {submitting ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
            {submitting ? "正在校验…" : "导入元数据"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
