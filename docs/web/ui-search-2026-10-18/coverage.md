# 搜索一致性断点（源码核查中）

分支codex/ui-search-1018，专用副本C:\wb-dev\wb-ui-search-1018，基线59037fb7772a1b96c9fbf1954e7eee0714f06664。仅UI，不混旧模型入口待核分支。

已读任务/CLAUDE/A1/C9及两张原图。SearchField外层label包多个按钮，准备改为非label容器并显式维持输入聚焦；shell/pages/common存在覆盖。实际源码官方与自定义PlazaTab当前都无可见submit，添加朋友已有按钮但submit未trim。专注页在play.tsx，不含搜索，不强加SearchField。全部调用点和待GUI矩阵后续补齐；未点按/未检查通过。
