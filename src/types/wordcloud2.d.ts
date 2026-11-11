/**
 * wordcloud2 没有官方类型声明，这里只声明我们用到的部分。
 * 库本体是 UMD 单文件，默认导出一个 `WordCloud(canvas, options)` 函数。
 */
// 注意：wordcloud2 包的 main 指向它的演示页脚本（index.js），真正的库在 src/wordcloud2.js
declare module 'wordcloud2/src/wordcloud2.js' {
  interface WordCloudOptions {
    /** [文本, 权重] 数组 */
    list: Array<[string, number] | [string, number, string]>
    gridSize?: number
    /** 权重 → 字号（px）。传函数可以做自定义映射 */
    weightFactor?: number | ((weight: number) => number)
    fontFamily?: string
    color?: string | ((word: string, weight: number, fontSize: number) => string)
    backgroundColor?: string
    /** 有多大的概率把词旋转 90° */
    rotateRatio?: number
    minRotation?: number
    maxRotation?: number
    rotationSteps?: number
    /** 布局放不下时返回 false（默认吞掉） */
    abortThreshold?: number
    clearCanvas?: boolean
    /** 鼠标悬停在某个词上时触发；移出时 item 为 null */
    hover?: (
      item: Record<number, string | number> | null,
      dimension: { x: number; y: number; w: number; h: number } | undefined,
      event: MouseEvent,
    ) => void
    click?: (item: Record<number, string | number> | null) => void
  }

  function WordCloud(canvas: HTMLCanvasElement, options: WordCloudOptions): boolean

  export default WordCloud
}
