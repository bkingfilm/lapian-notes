import type { Project, Segment, Subtitle } from '../types'
import type { Locale } from '../i18n/core'
import { createGeneratedTextLocalizer, protectProjectAuthoredText, protectSegmentAuthoredText } from '../i18n/generated'
import { translateText } from '../i18n/translate'
import { compactProjectForPersistence, normalizeLoadedProject } from './project'
import { exportMarkdown } from './markdown'
import { frameFileName, imageMimeFromFileName, possibleFrameFileNames } from './frameFileName'
import { secondsToTimecode } from './timecode'

interface ZipEntry {
  path: string
  bytes: Uint8Array
  crc: number
}

export type FileSaveResult = 'saved' | 'downloaded'

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

const DEFAULT_PROJECT_NAME = '拉片项目'
const PROJECT_PACKAGE_SUFFIX = '项目'
const ZIP_FILE_LABEL = 'ZIP 文件'

export async function exportProjectPackage(project: Project, locale: Locale = 'zh-CN'): Promise<FileSaveResult> {
  const exportableFrames = project.frames.filter((frame) => isDataImage(frame.src))
  const projectJson = {
    ...compactProjectForPersistence(project),
    packagedAt: new Date().toISOString(),
  }
  const entries: ZipEntry[] = [
    createTextEntry('project.json', JSON.stringify(projectJson, null, 2)),
    createTextEntry('analysis.md', exportMarkdown(project, locale)),
    ...(await Promise.all(
      exportableFrames.map(async (frame) => createBinaryEntry('frames/' + frameFileName(frame), await dataUrlToBytes(frame.src))),
    )),
    createTextEntry(
      'manifest.json',
      JSON.stringify(
        {
          projectTitle: project.projectTitle,
          filmTitle: project.filmTitle,
          sourceVideoName: project.sourceVideoName,
          frameCount: project.frames.length,
          imageCount: exportableFrames.length,
          exportedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    ),
  ]

  const fallbackName = translateText(DEFAULT_PROJECT_NAME, locale)
  const suffix = translateText(PROJECT_PACKAGE_SUFFIX, locale)
  return saveZip(
    `${safeName(project.projectTitle || project.filmTitle || fallbackName, fallbackName)}-${suffix}.zip`,
    entries,
    locale,
  )
}

// 上传 ZIP 给 AI 时配的开场白。任务详情在包内 prompt.md,但 AI 不会主动解压,必须由这句话触发
export function buildAiChatMessage(locale: Locale = 'zh-CN'): string {
  return translateText('解压这个 ZIP，严格按照包内 prompt.md 的要求分析这部电影，参考 frames/ 截图和 subtitles.srt，最终只输出符合 schema.json 结构的 JSON 文件给我下载，不要输出 JSON 之外的内容。', locale)
}

export async function exportAiAnalysisPackage(project: Project, locale: Locale = 'zh-CN'): Promise<FileSaveResult> {
  const exportableFrames = project.frames.filter((frame) => isDataImage(frame.src))
  if (!exportableFrames.length) throw new Error(translateText('没有可导出的抽帧图片，请先导入电影并完成抽帧。', locale))
  const exportedAt = new Date().toISOString()
  const entries: ZipEntry[] = [
    createTextEntry('README.md', buildAiReadme(project, locale)),
    createTextEntry('prompt.md', buildAiPrompt(project, locale)),
    createTextEntry('schema.json', JSON.stringify(buildAiSchema(), null, 2)),
    createTextEntry('project.json', JSON.stringify(buildAiProjectMeta(project, exportableFrames.length, exportedAt), null, 2)),
    ...(project.subtitles.length
      ? [
          createTextEntry('subtitles.json', JSON.stringify(project.subtitles, null, 2)),
          createTextEntry('subtitles.srt', buildSrt(project)),
        ]
      : []),
    ...(await Promise.all(
      exportableFrames.map(async (frame) => createBinaryEntry('frames/' + frameFileName(frame), await dataUrlToBytes(frame.src))),
    )),
  ]

  const fallbackName = translateText(DEFAULT_PROJECT_NAME, locale)
  const suffix = translateText('AI分析包', locale)
  return saveZip(
    `${safeName(project.projectTitle || project.filmTitle || fallbackName, fallbackName)}-${suffix}.zip`,
    entries,
    locale,
  )
}

// 单段深拆包:只装选中段落的帧和字幕,让 AI 把这一段拆到场和镜头级
export async function exportSegmentDeepDivePackage(
  project: Project,
  segment: Segment,
  locale: Locale = 'zh-CN',
): Promise<FileSaveResult> {
  const segmentFrames = project.frames.filter(
    (frame) => frame.time >= segment.startTime && frame.time <= segment.endTime && isDataImage(frame.src),
  )
  if (!segmentFrames.length) throw new Error(translateText('这个段落没有可导出的帧图，请先完成抽帧。', locale))
  const segmentSubtitles = project.subtitles.filter(
    (subtitle) => subtitle.startTime <= segment.endTime && subtitle.endTime >= segment.startTime,
  )
  const entries: ZipEntry[] = [
    createTextEntry(
      'prompt.md',
      buildSegmentDeepDivePrompt(project, segment, segmentFrames.length, segmentSubtitles.length, locale),
    ),
    createTextEntry('schema.json', JSON.stringify(buildSegmentDeepDiveSchema(segment), null, 2)),
    createTextEntry('subtitles.srt', buildSrtFromSubtitles(segmentSubtitles)),
    createTextEntry(
      'segment.json',
      JSON.stringify(
        {
          movieIdentity: {
            projectTitle: project.projectTitle,
            filmTitle: project.filmTitle,
            sourceVideoName: project.sourceVideoName,
          },
          segmentId: segment.id,
          startTime: segment.startTime,
          endTime: segment.endTime,
          title: segment.title,
          type: segment.type,
          currentDraft: segment.screenplayDraft ?? '',
          currentFunction: segment.segmentFunction ?? '',
        },
        null,
        2,
      ),
    ),
    ...(await Promise.all(
      segmentFrames.map(async (frame) => createBinaryEntry('frames/' + frameFileName(frame), await dataUrlToBytes(frame.src))),
    )),
  ]
  const rangeText = `${secondsToTimecode(segment.startTime)}-${secondsToTimecode(segment.endTime)}`.replaceAll(':', '')
  const fallbackName = translateText(DEFAULT_PROJECT_NAME, locale)
  const suffix = translateText('段落深拆', locale)
  return saveZip(
    `${safeName(project.projectTitle || project.filmTitle || fallbackName, fallbackName)}-${suffix}-${rangeText}.zip`,
    entries,
    locale,
  )
}

function buildSegmentDeepDivePrompt(
  project: Project,
  segment: Segment,
  frameCount: number,
  subtitleCount: number,
  locale: Locale = 'zh-CN',
): string {
  const localizer = createGeneratedTextLocalizer(locale)
  const protectedProject = protectProjectAuthoredText(project, localizer.protect)
  const protectedSegment = protectSegmentAuthoredText(segment, localizer.protect)
  return localizer.localize(
    buildSegmentDeepDivePromptSource(protectedProject, protectedSegment, frameCount, subtitleCount),
  )
}

function buildSegmentDeepDivePromptSource(project: Project, segment: Segment, frameCount: number, subtitleCount: number): string {
  return [
    '你是一名电影拉片助手。这个压缩包只包含一部电影中的一个段落，请把这一段拆到“场与镜头”级别，返回“拉片笔记”能导入的 JSON。',
    '',
    `影片名：${project.filmTitle || project.projectTitle || '未命名影片'}`,
    `段落范围：${secondsToTimecode(segment.startTime)} - ${secondsToTimecode(segment.endTime)}（${Math.round(segment.endTime - segment.startTime)} 秒）`,
    `段落现有标题：${segment.title || '未命名'}`,
    `帧数量：${frameCount}（1 秒 1 帧，文件名含时间码）`,
    `字幕数量：${subtitleCount}（subtitles.srt，时间为全片时间轴）`,
    'segment.json 里有这一段现有的粗版分析，你的任务是替换成精细版。',
    '',
    '深拆要求：',
    '1. screenplayBlocks 是本次的核心产出：按时间顺序把这一段拆成场景、动作、对白小节。场景变化必须有“场景”条目；对白直接引用字幕原文；动作描述画面里实际发生的事。平均每 15-30 秒至少一条，一个段落通常应有 15-40 条。每条带 time（全片时间轴的秒数）。',
    '2. techniques 必填：逐镜头观察 frames/ 里的构图、景别、机位变化、剪辑节奏、转场方式，写 3-8 条视听手法，用换行分隔。',
    '3. keyBeats：本段的关键节拍，每条前标时间码。',
    '4. 其余字段（screenplayDraft、segmentFunction、creativeIntent、informationControl、rhythmDesign、audienceExperience、reusableMethod）针对本段精写。',
    '5. 事实纪律：人物名、地名、身份必须以字幕和画面证据为准，没有证据宁可留空，不要脑补。',
    '6. segmentId、startTime、endTime 必须原样带回，用于导入时定位段落。',
    '7. 输出语言：所有描述性文本用与字幕相同的语言书写（没有字幕时用影片对白的语言）；screenplayBlocks 的 type 必须原样使用「场景/动作/对白」这些值，不要翻译。',
    '',
    '请严格返回 JSON，不要输出 JSON 之外的说明。顶层必须包含 movieIdentity 和 segmentDeepDive，结构见 schema.json。',
  ].join('\n')
}

function buildSegmentDeepDiveSchema(segment: Segment) {
  return {
    movieIdentity: {
      projectTitle: '项目名，原样带回',
      filmTitle: '影片名，原样带回',
      sourceVideoName: '源视频文件名，原样带回',
    },
    segmentDeepDive: {
      segmentId: segment.id,
      startTime: segment.startTime,
      endTime: segment.endTime,
      title: '具体剧情事件标题',
      screenplayDraft: '本段精细版故事总结',
      segmentFunction: '本段在全片中的作用',
      keyBeats: '52:30 节拍一\n54:10 节拍二（每条带时间码）',
      screenplayBlocks: [
        { type: '场景', time: segment.startTime, text: '场景头：地点与时间' },
        { type: '动作', time: segment.startTime + 20, text: '画面里实际发生的动作' },
        { type: '对白', time: segment.startTime + 40, text: '引用字幕原文的对白' },
      ],
      techniques: '手持跟拍制造不稳定感\n对切镜头逐渐收紧景别\n音乐在 53:20 抽掉，只留环境声',
      creativeIntent: '创作意图',
      informationControl: '信息释放方式',
      rhythmDesign: '节奏设计',
      audienceExperience: '观众体验',
      reusableMethod: '可复用写法',
      confidence: 0.9,
    },
  }
}

export async function importProjectPackage(
  file: File,
  locale: Locale = 'zh-CN',
): Promise<{ project: Project; restoredCount: number }> {
  const entries = readZipEntries(new Uint8Array(await file.arrayBuffer()), locale)
  const projectEntry = entries.get('project.json')
  if (!projectEntry) throw new Error(translateText('项目文件缺少 project.json。', locale))

  const project = normalizeLoadedProject(JSON.parse(textDecoder.decode(projectEntry)))
  const restoredFrames = await Promise.all(
    project.frames.map(async (frame) => {
      const fileName = possibleFrameFileNames(frame).find((name) => entries.has('frames/' + name))
      if (!fileName) return frame
      const bytes = entries.get('frames/' + fileName)
      if (!bytes) return frame
      return { ...frame, src: bytesToObjectUrl(bytes, imageMimeFromFileName(fileName)) }
    }),
  )
  const restoredCount = restoredFrames.filter((frame) => isDataImage(frame.src)).length
  return {
    project: {
      ...project,
      frames: restoredFrames,
    },
    restoredCount,
  }
}

function createTextEntry(path: string, content: string): ZipEntry {
  return createBinaryEntry(path, textEncoder.encode(content))
}

function buildAiReadme(project: Project, locale: Locale = 'zh-CN'): string {
  const localizer = createGeneratedTextLocalizer(locale)
  const protectedProject = protectProjectAuthoredText(project, localizer.protect)
  const packageLabel = translateText('AI分析包', locale)
  return localizer.localize(buildAiReadmeSource(protectedProject, packageLabel))
}

function buildAiReadmeSource(project: Project, packageLabel: string): string {
  return [
    '# ' + (project.projectTitle || project.filmTitle || DEFAULT_PROJECT_NAME) + ' ' + packageLabel,
    '',
    '这个压缩包用于交给 AI 分析电影结构。',
    '',
    '## 包内文件',
    '- frames/：按时间顺序抽出的电影截图，文件名包含时间码。',
    project.subtitles.length ? '- subtitles.srt：字幕文本。' : '',
    project.subtitles.length ? '- subtitles.json：结构化字幕。' : '',
    '- project.json：影片元数据和帧时间。',
    '- prompt.md：给 AI 的分析任务。',
    '- schema.json：AI 必须返回的 JSON 结构。',
    '',
    '请把 AI 返回的 JSON 文件导入回“拉片笔记”的“导入 AI 结果”。',
  ].filter(Boolean).join('\n')
}

// 国内大模型(Kimi/豆包/通义等)不支持上传 ZIP,免压缩包模式改为散文件+画面速览拼图
export interface LooseSheetInfo {
  sheetCount: number
  tileIntervalSeconds: number
}

export function buildAiPrompt(project: Project, locale: Locale = 'zh-CN', looseSheets?: LooseSheetInfo): string {
  const localizer = createGeneratedTextLocalizer(locale)
  const protectedProject = protectProjectAuthoredText(project, localizer.protect)
  return localizer.localize(buildAiPromptSource(protectedProject, looseSheets))
}

function buildAiPromptSource(project: Project, looseSheets?: LooseSheetInfo): string {
  return [
    looseSheets
      ? '你是一名电影剧本拆解助手。我上传的文件是一部电影的分析材料：任务说明（本文件）、画面速览拼图，可能还有字幕全文。请据此把电影整理成“拉片笔记”能导入的 JSON。'
      : '你是一名电影剧本拆解助手。请读取这个压缩包中的截图、字幕和资料，把电影整理成“拉片笔记”能导入的 JSON。',
    ...(looseSheets
      ? [
          '',
          `画面速览拼图共 ${looseSheets.sheetCount} 张：每张由多格电影截图按时间顺序拼成，每格左上角标着这格画面的时间码，截图间隔约 ${looseSheets.tileIntervalSeconds} 秒。`,
        ]
      : []),
    '',
    '核心目标：',
    '1. 按真实剧情变化切分段落，不要按片长平均切。',
    '2. 每个段落必须有具体剧情事件标题，不要使用“开场建立”“目标与阻力出现”等模板标题。',
    '3. 每个段落必须写“故事总结”：概括这一段发生了什么，不要直接复制字幕原文。',
    '4. 每个段落必须写“作用”：评价这一段在整部影片结构、人物关系、信息释放和节奏中的作用。',
    '5. 结构树应区分主线、支线、情感线、信息线、节奏/过渡线；允许同一段属于多条线。',
    project.subtitles.length
      ? (looseSheets
          ? '6. 每段请结合字幕全文和速览拼图里对应时间码的画面判断剧情。'
          : '6. 每段请参考 frames/ 中起点、中点、终点附近的画面，并结合 subtitles.srt 判断剧情。')
      : (looseSheets
          ? '6. 没有字幕：对白无法获得，请完全依靠速览拼图的画面判断剧情，无法确认的对白内容不要编造。'
          : '6. 本包没有字幕：对白无法获得，请完全依靠 frames/ 画面截图判断剧情，无法确认的对白内容不要编造。'),
    '7. 事实纪律：人物名、地名、身份、故事发生地等设定必须以字幕和画面证据为准，没有证据就不要写；宁可留空，不要脑补。',
    '8. keyBeats 里每个节拍前面标注时间码（如“52:30 小鱼提出同住”），方便人工回看核对。',
    looseSheets
      ? '9. techniques 字段必填：每段至少写一条镜头、剪辑或转场层面的视听手法，从速览拼图里观察构图和景别变化；画面间隔较大，只写有画面证据的。'
      : '9. techniques 字段必填：每段至少写一条镜头、剪辑、声音或转场层面的视听手法，从 frames/ 截图里观察构图和景别变化。',
    // 用户不一定是中文用户,产出语言必须跟片子走,否则英文用户拿到中文笔记没法用
    '10. 输出语言：所有描述性文本字段（title、screenplayDraft、segmentFunction、keyBeats、techniques 等）必须使用与字幕相同的语言书写；没有字幕时使用影片对白的语言。type、narrativeOrder、importance、剧本小节的 type 等枚举值除外：必须原样使用本说明列出的值，不要翻译。',
    '',
    '请严格返回 JSON，不要输出 JSON 之外的说明。JSON 顶层必须包含 movieIdentity 和 segments，可选包含 macroAnalysis、storyLines。',
    'movieIdentity 必须原样带回影片名、项目名和源视频文件名，用于工具导入时校验是否选错电影。',
    '可以额外返回 audienceCurvePoints，用来描述全片观众投入强度、情绪方向和体验变化。',
    '',
    '剧情线（storyLines）规则：',
    '- 默认剧情线为：protagonist_action（主角行动线）/ antagonist_pressure（对抗压力线）/ relationship_emotion（关系情感线）/ world_context（外部世界线）/ subplot_info（支线信息线）。',
    '- 强烈建议返回 storyLines 数组，为这部电影定制每条线的名字，例如把“主角行动线”命名为具体人物的行动线。',
    '- storyLines 每项包含 id/title/subtitle/description；id 用英文小写下划线；不要定义 audience_experience，观众体验线由工具固定提供。',
    '- 每个 segment 的 primaryLine 和 sharedLines 必须使用 storyLines 里定义的 id（或默认 id）。',
    '',
    '每个 segment 字段要求：',
    '- startTime/endTime：秒数。',
    '- title：具体剧情事件标题。',
    '- type：开场/起/承/转/合/冲突/推进/转折/升级/低谷/高潮/结尾/支线/过渡/背景/说明/结论 之一。',
    '- narrativeOrder：主线/支线/多线并行/顺叙等。',
    '- screenplayDraft：故事总结，必须是整理后的剧情概括。',
    '- segmentFunction：这一段在影片中的作用，必须针对本段具体剧情。',
    '- rhythmDesign：这一段的节奏作用。',
    '- primaryLine：主归属线 id，必须是 storyLines 中定义的 id。',
    '- isShared/sharedLines：如果同时影响多条线索，isShared 为 true，sharedLines 写全部影响线索且必须包含 primaryLine。',
    '- importance：normal/key/pivot 之一；结构枢纽用 pivot。',
    '- structureRole：多线复用或结构枢纽的具体作用。',
    '- screenplayBlocks：每段 4 到 10 条，按时间顺序拆成场景、动作、对白小节；对白条目直接引用字幕原文，动作条目描述画面里实际发生的事。这是拉片笔记的正文，不要只给两三条。',
    '- techniques：必填，本段的视听手法（镜头、剪辑、声音、转场）。',
    '- confidence：0 到 1。',
    '',
    'Audience curve rules:',
    '- audienceCurvePoints must describe viewer experience, not plot importance.',
    '- Do not make intensity mechanically rise over time.',
    '- intensity means immediate viewer activation from 0 to 100; it is not happiness and not importance.',
    '- Quiet but gripping scenes (a confession, a breakdown, a silent stare-down) are HIGH intensity with negative or low valence. Do not confuse loudness with intensity.',
    '- Include local rises and falls: at least 3 clear drops/pressure lows, at least 2 clear rises, at least 1 low, 1-3 peaks, and an aftertaste after climax.',
    '- Generate 12-20 points for the whole film, not one point for every segment.',
    '- rhythmRole must be one of setup/rise/drop/pressure/release/cooldown/suspense/peak/low/aftertaste.',
    '- description must explain why the audience experience changes here and what rhythmRole it serves.',
    '- valence is emotional direction from -100 to 100.',
    '- emotionType: curiosity/humor/warmth/romance/tension/anxiety/sadness/conflict/hope/release/inspiration/aftertaste.',
    '- importance: normal/key/peak/low.',
    '- relatedBlockIds should reference segment ids when possible; otherwise use an empty array.',
    `影片名：${project.filmTitle || project.projectTitle || '未命名影片'}`,
    `项目名：${project.projectTitle || project.filmTitle || '未命名项目'}`,
    `源视频文件名：${project.sourceVideoName || '未记录'}`,
    `片长：${project.duration} 秒`,
    ...(looseSheets
      ? [`画面速览拼图：${looseSheets.sheetCount} 张，截图间隔约 ${looseSheets.tileIntervalSeconds} 秒`]
      : [`抽帧间隔：${project.frameInterval} 秒`, `帧数量：${project.frames.length}`]),
    `字幕数量：${project.subtitles.length}`,
    // 免压缩包模式没有独立的 schema.json,结构示例直接附在任务说明末尾
    ...(looseSheets
      ? ['', '返回 JSON 的结构示例（严格按这个结构，字段要求写在示例值里）：', JSON.stringify(buildAiSchema(), null, 2)]
      : []),
  ].filter(Boolean).join('\n')
}

function buildAiSchema() {
  return {
    movieIdentity: {
      projectTitle: '项目名',
      filmTitle: '影片名',
      sourceVideoName: '源视频文件名',
    },
    storyLines: [
      {
        id: 'protagonist_action',
        title: '为这部电影定制的线名，比如“某某的反击线”',
        subtitle: '目标 / 选择 / 行动 / 代价',
        description: '这条线只放什么内容',
      },
    ],
    macroAnalysis: {
      overallStructure: '全片结构判断',
      narrativeStrategy: '主角目标、阻力、利害',
      rhythmPattern: '关键转折、高潮、解决',
      informationStrategy: '信息释放、悬念、反转',
      coreCreativeIntent: '人物变化、主题选择',
      writingLessons: ['可复用写法'],
      confidence: 0.8,
    },
    segments: [
      {
        startTime: 0,
        endTime: 60,
        type: '开场',
        title: '具体剧情事件标题',
        narrativeOrder: '主线',
        screenplayDraft: '这一段的故事总结，不复制字幕原文。',
        segmentFunction: '这一段在影片中的具体作用。',
        keyBeats: '关键节拍。',
        rhythmDesign: '节奏作用。',
        primaryLine: 'protagonist_action',
        isShared: false,
        sharedLines: ['protagonist_action'],
        importance: 'normal',
        structureRole: '如果是多线复用或结构枢纽，说明它同时改变了哪些线索。',
        screenplayBlocks: [
          { type: '场景', time: 0, text: '场景头或场景描述' },
          { type: '动作', time: 10, text: '动作和情节推进' },
        ],
        creativeIntent: '创作意图',
        informationControl: '信息释放方式',
        audienceExperience: '观众体验',
        reusableMethod: '可复用写法',
        confidence: 0.8,
      },
    ],
    audienceCurvePoints: [
      {
        id: 'aud_001',
        time: 0,
        intensity: 35,
        valence: 0,
        emotionType: 'curiosity',
        rhythmRole: 'setup',
        title: '观众体验变化点',
        description: '说明这个点为什么成立。',
        relatedBlockIds: [],
        importance: 'normal',
        showLabel: false,
        source: 'ai',
      },
    ],
  }
}

function buildAiProjectMeta(project: Project, imageCount: number, exportedAt: string) {
  return {
    projectTitle: project.projectTitle,
    filmTitle: project.filmTitle,
    sourceVideoName: project.sourceVideoName,
    duration: project.duration,
    frameInterval: project.frameInterval,
    frameCount: project.frames.length,
    imageCount,
    subtitleCount: project.subtitles.length,
    exportedAt,
    frames: project.frames.map((frame) => ({
      index: frame.index,
      time: frame.time,
      file: `frames/${frameFileName(frame)}`,
    })),
  }
}

function buildSrt(project: Project): string {
  return buildSrtFromSubtitles(project.subtitles)
}

export function buildSrtFromSubtitles(subtitles: Subtitle[]): string {
  return subtitles
    .map((subtitle, index) => [
      String(index + 1),
      `${formatSrtTime(subtitle.startTime)} --> ${formatSrtTime(subtitle.endTime)}`,
      subtitle.text,
      '',
    ].join('\n'))
    .join('\n')
}

function formatSrtTime(seconds: number): string {
  const safeMs = Math.max(0, Math.round(seconds * 1000))
  const hours = Math.floor(safeMs / 3600000)
  const minutes = Math.floor((safeMs % 3600000) / 60000)
  const secs = Math.floor((safeMs % 60000) / 1000)
  const ms = safeMs % 1000
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`
}

function createBinaryEntry(path: string, bytes: Uint8Array): ZipEntry {
  return {
    path,
    bytes,
    crc: crc32(bytes),
  }
}

export function isDataImage(src: string): boolean {
  return src.startsWith('data:image/') || src.startsWith('blob:')
}

async function dataUrlToBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url)
  return new Uint8Array(await response.arrayBuffer())
}

function bytesToObjectUrl(bytes: Uint8Array, mime: string): string {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  return URL.createObjectURL(new Blob([buffer], { type: mime }))
}

async function saveZip(filename: string, entries: ZipEntry[], locale: Locale = 'zh-CN'): Promise<FileSaveResult> {
  const zipBytes = createZip(entries)
  const zipBuffer = zipBytes.buffer.slice(zipBytes.byteOffset, zipBytes.byteOffset + zipBytes.byteLength) as ArrayBuffer
  return saveBlobFile(filename, new Blob([zipBuffer], { type: 'application/zip' }), locale)
}

async function saveBlobFile(
  filename: string,
  blob: Blob,
  locale: Locale = 'zh-CN',
): Promise<FileSaveResult> {
  const picker = (window as Window & {
    showSaveFilePicker?: (options: {
      suggestedName: string
      types: Array<{ description: string; accept: Record<string, string[]> }>
    }) => Promise<{ createWritable: () => Promise<{ write: (blob: Blob) => Promise<void>; close: () => Promise<void> }> }>
  }).showSaveFilePicker

  if (picker) {
    try {
      const handle = await picker({
        suggestedName: filename,
        types: [{ description: translateText(ZIP_FILE_LABEL, locale), accept: { 'application/zip': ['.zip'] } }],
      })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      return 'saved'
    } catch (error) {
      // 用户主动取消保存时不要偷偷改成自动下载
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      // 自动流程没有用户手势,picker 会被浏览器拒绝(SecurityError),落到自动下载
    }
  }

  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
  return 'downloaded'
}

function createZip(entries: ZipEntry[]): Uint8Array {
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBytes = textEncoder.encode(entry.path)
    const localHeader = createLocalHeader(entry, nameBytes)
    localParts.push(localHeader, nameBytes, entry.bytes)
    centralParts.push(createCentralHeader(entry, nameBytes, offset), nameBytes)
    offset += localHeader.length + nameBytes.length + entry.bytes.length
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0)
  const centralOffset = offset
  const end = createEndRecord(entries.length, centralSize, centralOffset)
  return concatBytes([...localParts, ...centralParts, end])
}

function readZipEntries(bytes: Uint8Array, locale: Locale = 'zh-CN'): Map<string, Uint8Array> {
  const entries = new Map<string, Uint8Array>()
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 0

  while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const method = view.getUint16(offset + 8, true)
    if (method !== 0) {
      throw new Error(
        translateText('当前仅支持未压缩 ZIP，请使用本工具导出的文件。', locale),
      )
    }
    const compressedSize = view.getUint32(offset + 18, true)
    const fileNameLength = view.getUint16(offset + 26, true)
    const extraLength = view.getUint16(offset + 28, true)
    const nameStart = offset + 30
    const dataStart = nameStart + fileNameLength + extraLength
    const dataEnd = dataStart + compressedSize
    const name = textDecoder.decode(bytes.slice(nameStart, nameStart + fileNameLength))
    entries.set(name, bytes.slice(dataStart, dataEnd))
    offset = dataEnd
  }

  return entries
}

function createLocalHeader(entry: ZipEntry, nameBytes: Uint8Array): Uint8Array {
  const header = new Uint8Array(30)
  const view = new DataView(header.buffer)
  view.setUint32(0, 0x04034b50, true)
  view.setUint16(4, 20, true)
  view.setUint16(6, 0x0800, true)
  view.setUint16(8, 0, true)
  view.setUint16(10, 0, true)
  view.setUint16(12, 0, true)
  view.setUint32(14, entry.crc, true)
  view.setUint32(18, entry.bytes.length, true)
  view.setUint32(22, entry.bytes.length, true)
  view.setUint16(26, nameBytes.length, true)
  view.setUint16(28, 0, true)
  return header
}

function createCentralHeader(entry: ZipEntry, nameBytes: Uint8Array, offset: number): Uint8Array {
  const header = new Uint8Array(46)
  const view = new DataView(header.buffer)
  view.setUint32(0, 0x02014b50, true)
  view.setUint16(4, 20, true)
  view.setUint16(6, 20, true)
  view.setUint16(8, 0x0800, true)
  view.setUint16(10, 0, true)
  view.setUint16(12, 0, true)
  view.setUint16(14, 0, true)
  view.setUint32(16, entry.crc, true)
  view.setUint32(20, entry.bytes.length, true)
  view.setUint32(24, entry.bytes.length, true)
  view.setUint16(28, nameBytes.length, true)
  view.setUint16(30, 0, true)
  view.setUint16(32, 0, true)
  view.setUint16(34, 0, true)
  view.setUint16(36, 0, true)
  view.setUint32(38, 0, true)
  view.setUint32(42, offset, true)
  return header
}

function createEndRecord(entryCount: number, centralSize: number, centralOffset: number): Uint8Array {
  const header = new Uint8Array(22)
  const view = new DataView(header.buffer)
  view.setUint32(0, 0x06054b50, true)
  view.setUint16(8, entryCount, true)
  view.setUint16(10, entryCount, true)
  view.setUint32(12, centralSize, true)
  view.setUint32(16, centralOffset, true)
  return header
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const output = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.length
  }
  return output
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let index = 0; index < 8; index += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

export function safeName(value: string, fallback = DEFAULT_PROJECT_NAME): string {
  return value.trim().replace(/[\\/:*?"<>|]/g, '_') || fallback
}
