"use client";

import {
  Bell,
  Database,
  Gauge,
  Info,
  LoaderCircle,
  Palette,
  RotateCcw,
  Save,
  Settings2,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { PageContainer } from "@/components/shell/page-container";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useSidebar } from "@/components/ui/sidebar";
import {
  getWorkspaceSettings,
  resetWorkspaceSettings,
  updateWorkspaceSettings,
} from "@/lib/api/endpoints";
import type {
  WorkspaceSettingsRead,
  WorkspaceSettingsValues,
} from "@/lib/api/types";

const STORAGE_KEY = "opencli-settings";
const DEFAULTS: WorkspaceSettingsValues = {
  theme: "system",
  motion_enabled: true,
  sidebar_mode: "expanded",
  timezone: "Asia/Shanghai",
  landing_page: "/dashboard",
  default_concurrency: 4,
  automatic_retries: true,
  retain_raw_data: true,
  retention_days: 30,
  inbox_alerts: true,
  failure_alerts: true,
  agent_alerts: true,
};

function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-6 border-b py-3 last:border-b-0">
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        <div className="mt-0.5 text-xs leading-5 text-muted-foreground">
          {description}
        </div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function SettingsSection({
  icon: Icon,
  title,
  description,
  nextRun = false,
  children,
}: {
  icon: typeof Settings2;
  title: string;
  description: string;
  nextRun?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="border-b">
        <div className="flex items-start justify-between gap-4">
          <div className="flex gap-3">
            <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
              <Icon className="size-4" />
            </div>
            <div>
              <CardTitle className="text-base">{title}</CardTitle>
              <CardDescription className="mt-1">{description}</CardDescription>
            </div>
          </div>
          {nextRun ? <Badge variant="outline">下次运行生效</Badge> : null}
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export default function SettingsPage() {
  const { setTheme } = useTheme();
  const { setMode } = useSidebar();
  const [preferences, setPreferences] = useState(DEFAULTS);
  const [metadata, setMetadata] = useState<WorkspaceSettingsRead | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback(
    (values: WorkspaceSettingsValues) => {
      setPreferences(values);
      setTheme(values.theme);
      setMode(values.sidebar_mode);
      document.documentElement.dataset.motion = values.motion_enabled
        ? "full"
        : "reduced";
    },
    [setMode, setTheme],
  );

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        setPreferences({ ...DEFAULTS, ...JSON.parse(saved) });
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }
    getWorkspaceSettings()
      .then((result) => {
        apply(result.values);
        setMetadata(result);
        setError(null);
      })
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }, [apply]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    document.documentElement.dataset.motion = preferences.motion_enabled
      ? "full"
      : "reduced";
  }, [preferences]);

  function update<K extends keyof WorkspaceSettingsValues>(
    key: K,
    value: WorkspaceSettingsValues[K],
  ) {
    setPreferences((current) => ({ ...current, [key]: value }));
    setDirty(true);
    if (key === "theme") setTheme(value as WorkspaceSettingsValues["theme"]);
    if (key === "sidebar_mode")
      setMode(value as WorkspaceSettingsValues["sidebar_mode"]);
  }

  async function save() {
    setSaving(true);
    try {
      const result = await updateWorkspaceSettings(preferences);
      apply(result.values);
      setMetadata(result);
      setDirty(false);
      setError(null);
      toast.success("设置已保存");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "保存设置失败";
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    setSaving(true);
    try {
      const result = await resetWorkspaceSettings();
      apply(result.values);
      setMetadata(result);
      setDirty(false);
      setError(null);
      toast.success("已恢复默认设置");
    } catch (reason) {
      const message =
        reason instanceof Error ? reason.message : "恢复默认设置失败";
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageContainer
      title="设置"
      eyebrow="Workspace"
      description="管理工作区体验与默认运行策略。安全配置暂不包含在本阶段。"
      actions={
        <>
          <Button
            variant="outline"
            onClick={reset}
            disabled={loading || saving}
          >
            <RotateCcw className="size-4" />
            恢复默认
          </Button>
          <Button onClick={save} disabled={loading || saving || !dirty}>
            {saving ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            保存设置
          </Button>
        </>
      }
    >
      <div className="flex items-center justify-between gap-4 rounded-lg border bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
        <span>
          {error
            ? `配置服务不可用：${error}。当前显示本地缓存。`
            : loading
              ? "正在读取工作区配置…"
              : "配置已连接统一 API。"}
        </span>
        {metadata ? (
          <span className="shrink-0 font-mono">REV {metadata.revision}</span>
        ) : null}
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <SettingsSection
          icon={Settings2}
          title="通用"
          description="工作区语言、时区与默认入口。"
        >
          <SettingRow title="语言" description="当前界面语言。">
            <Select value="zh-CN" disabled>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="zh-CN">简体中文</SelectItem>
              </SelectContent>
            </Select>
          </SettingRow>
          <SettingRow
            title="时区"
            description="用于调度时间、日志和审计时间戳。"
          >
            <Select
              value={preferences.timezone}
              onValueChange={(value) =>
                update("timezone", value ?? DEFAULTS.timezone)
              }
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Asia/Shanghai">Asia/Shanghai</SelectItem>
                <SelectItem value="UTC">UTC</SelectItem>
                <SelectItem value="America/New_York">
                  America/New York
                </SelectItem>
              </SelectContent>
            </Select>
          </SettingRow>
          <SettingRow title="启动页" description="登录成功后优先进入的页面。">
            <Select
              value={preferences.landing_page}
              onValueChange={(value) =>
                update(
                  "landing_page",
                  (value ??
                    DEFAULTS.landing_page) as WorkspaceSettingsValues["landing_page"],
                )
              }
            >
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="/dashboard">概览</SelectItem>
                <SelectItem value="/canvas">节点工作流</SelectItem>
                <SelectItem value="/inbox">Inbox</SelectItem>
              </SelectContent>
            </Select>
          </SettingRow>
        </SettingsSection>

        <SettingsSection
          icon={Palette}
          title="外观"
          description="立即应用到当前工作区。"
        >
          <SettingRow title="主题" description="跟随系统，或固定为浅色与深色。">
            <Select
              value={preferences.theme}
              onValueChange={(value) =>
                update(
                  "theme",
                  (value ?? "system") as WorkspaceSettingsValues["theme"],
                )
              }
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="system">跟随系统</SelectItem>
                <SelectItem value="dark">深色</SelectItem>
                <SelectItem value="light">浅色</SelectItem>
              </SelectContent>
            </Select>
          </SettingRow>
          <SettingRow
            title="动态效果"
            description="关闭后保留状态变化，移除非必要动画。"
          >
            <Switch
              checked={preferences.motion_enabled}
              onCheckedChange={(checked) => update("motion_enabled", checked)}
            />
          </SettingRow>
          <SettingRow title="侧栏默认状态" description="展开、紧凑或隐藏。">
            <Select
              value={preferences.sidebar_mode}
              onValueChange={(value) =>
                value &&
                update(
                  "sidebar_mode",
                  value as WorkspaceSettingsValues["sidebar_mode"],
                )
              }
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="expanded">展开</SelectItem>
                <SelectItem value="icon">紧凑</SelectItem>
                <SelectItem value="collapsed">隐藏</SelectItem>
              </SelectContent>
            </Select>
          </SettingRow>
        </SettingsSection>

        <SettingsSection
          icon={Gauge}
          title="运行"
          description="工作流执行的工作区默认值。"
          nextRun
        >
          <SettingRow
            title="默认并发"
            description="新建工作流时建议的并行任务数。"
          >
            <div className="flex w-44 items-center gap-3">
              <Slider
                value={[preferences.default_concurrency]}
                min={1}
                max={16}
                step={1}
                onValueChange={(value) =>
                  update(
                    "default_concurrency",
                    typeof value === "number" ? value : (value[0] ?? 4),
                  )
                }
              />
              <span className="w-5 text-right font-mono text-sm tabular-nums">
                {preferences.default_concurrency}
              </span>
            </div>
          </SettingRow>
          <SettingRow
            title="自动重试"
            description="节点瞬时失败时允许执行器按策略重试。"
          >
            <Switch
              checked={preferences.automatic_retries}
              onCheckedChange={(checked) =>
                update("automatic_retries", checked)
              }
            />
          </SettingRow>
        </SettingsSection>

        <SettingsSection
          icon={Database}
          title="数据"
          description="原始数据与产物的默认保留策略。"
          nextRun
        >
          <SettingRow
            title="保留原始数据"
            description="新数据源默认保存来源快照与溯源信息。"
          >
            <Switch
              checked={preferences.retain_raw_data}
              onCheckedChange={(checked) => update("retain_raw_data", checked)}
            />
          </SettingRow>
          <SettingRow
            title="默认保留周期"
            description="仅作为新任务模板的默认值。"
          >
            <Select
              value={String(preferences.retention_days)}
              onValueChange={(value) =>
                update(
                  "retention_days",
                  Number(
                    value ?? 30,
                  ) as WorkspaceSettingsValues["retention_days"],
                )
              }
            >
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">7 天</SelectItem>
                <SelectItem value="30">30 天</SelectItem>
                <SelectItem value="90">90 天</SelectItem>
                <SelectItem value="365">1 年</SelectItem>
              </SelectContent>
            </Select>
          </SettingRow>
        </SettingsSection>

        <SettingsSection
          icon={Bell}
          title="通知"
          description="Inbox 与运行异常提醒偏好。"
        >
          <SettingRow
            title="Inbox 动态"
            description="工作流需要人工介入时创建 Inbox 项。"
          >
            <Switch
              checked={preferences.inbox_alerts}
              onCheckedChange={(checked) => update("inbox_alerts", checked)}
            />
          </SettingRow>
          <SettingRow title="运行失败" description="任务或节点连续失败时提醒。">
            <Switch
              checked={preferences.failure_alerts}
              onCheckedChange={(checked) => update("failure_alerts", checked)}
            />
          </SettingRow>
          <SettingRow
            title="Agent 修复"
            description="Agent 发现、尝试或完成修复时提醒。"
          >
            <Switch
              checked={preferences.agent_alerts}
              onCheckedChange={(checked) => update("agent_alerts", checked)}
            />
          </SettingRow>
        </SettingsSection>

        <SettingsSection
          icon={Info}
          title="关于"
          description="当前控制台与运行环境信息。"
        >
          <SettingRow title="产品" description="数据节点执行与运营控制台。">
            <span className="text-sm">OpenCLI Admin</span>
          </SettingRow>
          <SettingRow title="节点协议" description="工作流节点统一执行协议。">
            <Badge variant="secondary">v1</Badge>
          </SettingRow>
          <SettingRow
            title="配置状态"
            description="设置由统一工作区配置 API 持久化。"
          >
            <Badge variant="outline">
              {error ? "Cached" : "API connected"}
            </Badge>
          </SettingRow>
        </SettingsSection>
      </div>
    </PageContainer>
  );
}
