# S43 OKB / USDt0 基础倍率特例

## 背景

用户确认 X Layer 上 `OKB -> USDt0` 的基础倍率应为 `0.1x`，并继续叠加 X Layer 链级 `+20%` 加成。旧实现只按 token group 判断，X Layer 原生 OKB 属于 `other`，USDt0 属于 `group1`，因此被误算为 `0.5x`。

## 实现

1. 在当前规则版本中增加 X Layer `OKB / USDt0` 交易对基础倍率特例：`0.1x`。
2. 特例按交易对处理，`OKB -> USDt0` 与 `USDt0 -> OKB` 共享同一基础倍率。
3. X Layer 链级加成保持 `1.2x`，因此无额外代币加成时最终系数为 `0.12x`。
4. 提升规则缓存版本，避免 parsed swap 继续复用旧的 `0.5x` 结果。
5. 旧规则窗口不变，2026-05-12 前交易仍走旧规则。

## 验收

1. 当前规则下 `OKB / USDt0` 返回 `0.1x`。
2. 当前规则下 `USDt0 / OKB` 返回 `0.1x`。
3. 当前规则下 `QIC / USDt0` 仍返回 `0.5x`。
4. 旧规则下 `OKB / USDt0` 仍返回旧规则倍率。
5. X Layer 链级加成仍为 `1.2x`。
6. `npm run build` 通过。
