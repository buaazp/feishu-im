/** Human-facing control messages; model answers retain the model's chosen language. */
export const messages = {
  'zh-CN': {
    started: '开始处理任务。',
    queued: '已排队，等待当前任务结束。',
    busy: '当前会话暂时无法接收任务，请稍后重新发送。',
    capacity: '当前运行的会话已达上限，请稍后重新发送。',
    idle: '空闲。发送文本即可开始或继续任务。',
    running: '处理中',
    stopping: '正在停止',
    pending: '等待消息',
    stopped: '任务已停止。',
    stopRequested: '已请求停止任务，并清空等待队列。',
    noTask: '当前没有运行中的任务。',
    help: '发送文本开始或继续任务。\n/dsh status 查看状态\n/dsh stop 停止任务并清空队列\n/dsh help 查看帮助',
    empty: '任务已结束，没有文本回复。',
    incomplete: '任务未完成，请查看 dsh 日志。',
    startupFailed: '任务启动失败，请查看 dsh 日志。',
    taskFailed: '任务处理或回复失败，请查看 dsh 日志；已执行的任务不会自动重试。',
  },
  en: {
    started: 'Working on your task.',
    queued: 'Queued. Waiting for the current task to finish.',
    busy: 'This conversation cannot accept another task yet. Please resend it later.',
    capacity: 'The conversation limit has been reached. Please resend your task later.',
    idle: 'Idle. Send text to start or continue a task.',
    running: 'Working',
    stopping: 'Stopping',
    pending: 'Queued messages',
    stopped: 'Task stopped.',
    stopRequested: 'Stop requested. Waiting messages have been cleared.',
    noTask: 'There is no running task.',
    help: 'Send text to start or continue a task.\n/dsh status Show activity\n/dsh stop Stop the task and clear waiting messages\n/dsh help Show help',
    empty: 'Task finished without a text response.',
    incomplete: 'Task did not complete. Check the dsh log.',
    startupFailed: 'The task could not start. Check the dsh log.',
    taskFailed: 'Task processing or reply delivery failed. Check the dsh log; executed tasks are not retried automatically.',
  },
} as const

/** Supported languages for control messages. */
export type Locale = keyof typeof messages
