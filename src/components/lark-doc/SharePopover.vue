<template>
  <!-- 🔴 这层包裹只为 Vue 2 的「单根节点」约束存在：只读遮罩、入口按钮、popover、
       二级 Dialog、toast 必须是**兄弟**（它们全是 `position: fixed`，若挂在彼此内部，
       祖先一旦有 transform 就会改写 fixed 的包含块而漂走）。包裹层自身**不能有
       transform / filter / overflow / 非 static 定位**，见 styles/share.css 同名注释。

       P6b-03 形态纪律（00-README 行 ~119）：分享是 **popover 不是 Dialog** —— 480×331、
       z 99、**无遮罩**、点击外部即关；二级「权限设置」才是 Dialog（z 1000，有遮罩）。
       两者是**两层叠加**：Dialog 打开时 popover 不关。 -->
  <div class="lark-doc-share-layer">
    <!-- canView:false —— 05 §5.3.1 B24 首行：8 项里**唯一**允许不挂载的一项。
         其余 7 项一律「挂载 + 置灰」，这里一条都不隐藏。 -->
    <div
      v-if="ed.shareViewMaskVisible"
      class="lark-doc-share-mask"
      role="alertdialog"
      aria-label="你没有查看权限"
    >
      <div class="lark-doc-share-mask-card">
        <!-- 图标位本库自定（04 未采遮罩内图标），只做 64×64 圆底 + 锁形描边。 -->
        <span
          class="lark-doc-share-mask-icon"
          aria-hidden="true"
        >
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <rect
              x="4.5"
              y="10.5"
              width="15"
              height="9.5"
              rx="2"
            /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /><path d="M12 14.5v2.5" />
          </svg>
        </span>
        <p class="lark-doc-share-mask-title">
          你没有查看权限
        </p>
        <!-- 04 §4.1.1 ⑥：申请流程**诚实未采**（需双账号）。这里只把点击抛给宿主，不自造审批流。 -->
        <button
          type="button"
          class="lark-doc-share-btn-filled"
          @click="ed.requestShareAccess()"
        >
          申请权限
        </button>
      </div>
    </div>
    <!-- 顶栏入口（宿主挂在 TopBar 的 header-actions slot 里）。按钮同干线 Ceditable：
         容器 100×32、本体 80×32 / var(--ld-share-brand) / radius 6 / pad 4px 11px（04 §4.1 ④-2）。
         降级形态（`canManagePermission:false`）时文案变成「分享只读链接」，但**不置灰**
         （B24 末行是「降级」不是「置灰」，点了要能复制）。 -->
    <div
      v-if="ed.shareEntryVisible"
      class="lark-doc-share-entry"
    >
      <button
        type="button"
        class="lark-doc-share-btn-filled"
        :aria-label="ed.shareEntryLabel"
        @click="ed.toggleSharePopover($event)"
      >
        {{ ed.shareEntryLabel }}
      </button>
    </div>
    <!-- popover 外壳 480×331 / z 99 / pad 2px 0 0 / 透明底 / radius 0。 -->
    <div
      v-if="ed.sharePopoverOpen"
      class="lark-doc-share-popover"
      role="dialog"
      aria-label="分享文档"
      :style="ed.sharePopoverStyle()"
    >
      <div class="lark-doc-share-popover-inner">
        <!-- 标题栏 480×45（pad 13px 16px 8px）：左「分享文档」64×22 fs16 var(--ld-share-text)，
             右「权限设置」84×24（图标 20×16）。 -->
        <div class="lark-doc-share-header">
          <h3 class="lark-doc-share-header-title">
            分享文档
          </h3>
          <div class="lark-doc-share-header-actions">
            <button
              type="button"
              class="lark-doc-share-perm-btn"
              aria-label="权限设置"
              @click="ed.openPermissionDialog()"
            >
              <!-- 齿轮图标 20×16（本库自定，04 只量了尺寸没给 SVG）。 -->
              <svg
                width="20"
                height="16"
                viewBox="0 0 20 16"
                fill="none"
                stroke="currentColor"
                stroke-width="1.4"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <circle
                  cx="10"
                  cy="8"
                  r="3.2"
                /><path d="M10 1.6v2.2M10 12.2v2.2M3.4 4.6l1.9 1.1M14.7 10.3l1.9 1.1M3.4 11.4l1.9-1.1M14.7 5.7l1.9-1.1" />
              </svg>
              <span>权限设置</span>
            </button>
          </div>
        </div>
        <!-- 协作者行 480×54（pad 0 16px）：左文案 70×20 fs14，右头像 26×26 + 溢出块 31×26。 -->
        <div class="lark-doc-share-member-row">
          <span class="lark-doc-share-member-text">已有协作者</span>
          <div class="lark-doc-share-avatars">
            <span
              class="lark-doc-share-avatar"
              aria-hidden="true"
            >{{ ed.shareCollaboratorInitial }}</span>
            <span class="lark-doc-share-avatar-more">+2</span>
          </div>
        </div>
        <!-- 邀请输入框：聚焦态是**外壳描边**（448×36 radius6 border 1px var(--ld-share-brand)），
             内部 input 393×26 无边框；右侧组织入口 36×34 靠 border-left 分割。 -->
        <div class="lark-doc-share-invite">
          <input
            :value="ed.shareInviteQuery"
            aria-label="邀请协作者"
            placeholder="搜索用户、群组、部门、用户组或智能体"
            @input="ed.setShareInviteQuery($event.target.value)"
          >
          <button
            type="button"
            class="lark-doc-share-org-entry"
            aria-label="选择组织范围"
          >
            ⌄
          </button>
        </div>
        <!-- 下半区 480×194（pad 12px 0 0）。 -->
        <div class="lark-doc-share-lower">
          <!-- 链接分享卡 480×116（pad 16）。 -->
          <div class="lark-doc-share-link-card">
            <div class="lark-doc-share-link-head">
              <span class="lark-doc-share-link-title">链接分享</span>
              <!-- 权限标签 bg rgba(20,86,240,0.2) / color var(--ld-share-brand) / fs10（内容 span 12px）/ radius 4。
                   文案取下拉同值的「可编辑」：③ 只认证了下拉取值与 scope 文案，标签文本未采。 -->
              <span class="lark-doc-share-link-tag"><span>{{ ed.shareLinkPermLabel }}</span></span>
            </div>
            <div class="lark-doc-share-link-body">
              <!-- 圆形图标 30×30 / bg var(--ld-share-avatar-bg) / radius 50%。 -->
              <span class="lark-doc-share-link-icon">
                <span
                  class="lark-doc-icon"
                  aria-hidden="true"
                >
                  <!-- eslint-disable-next-line vue/max-attributes-per-line -->
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 9.5l3-3" /><path d="M4.8 7.7 3.2 9.3a2.6 2.6 0 0 0 3.7 3.7l1.6-1.6" /><path d="M11.2 8.3l1.6-1.6a2.6 2.6 0 0 0-3.7-3.7L7.5 4.6" /></svg>
                </span>
              </span>
              <div class="lark-doc-share-link-main">
                <button
                  type="button"
                  class="lark-doc-share-org-btn"
                >
                  {{ ed.shareOrgName }}
                </button>
                <!-- 权限说明 var(--ld-share-text-secondary) / fs 12。文案由 mixin 拼装（一级口径：跟着上面那个下拉变）。 -->
                <span class="lark-doc-share-scope-text">{{ ed.shareScopeText }}</span>
              </div>
              <select
                class="lark-doc-share-perm-select"
                aria-label="链接权限"
                :value="ed.shareLinkPermLabel"
                @change="ed.setShareLinkPerm($event.target.value)"
              >
                <option
                  v-for="option in ed.shareLinkPermOptions"
                  :key="option"
                  :value="option"
                >
                  {{ option }}
                </option>
              </select>
            </div>
            <div class="lark-doc-share-copy-row">
              <button
                type="button"
                class="lark-doc-share-btn-filled"
                @click="ed.copyShareLink()"
              >
                复制链接
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
    <!-- 二级权限 Dialog（z 1000 / 有遮罩）。打开时 popover **不关**（04 §4.1.1 ① 两层叠加）。 -->
    <permission-dialog
      v-if="ed.permissionDialogOpen"
      :ed="ed"
    />
    <!-- 两型 toast：成功/复制绿（⑤-4）、校验失败橙（⑤-9），约 3s 自动消失。 -->
    <div
      v-if="ed.shareToast"
      class="lark-doc-share-toast"
      :class="`is-${ed.shareToast.kind}`"
      role="status"
    >
      <span class="lark-doc-share-toast-text">{{ ed.shareToast.text }}</span>
    </div>
  </div>
</template>

<script>
/**
 * 分享 popover（P6b-03）—— 顶栏入口 + 一级分享面板 + 只读遮罩入口。
 *
 * 规格：requirements/04 §4.1（结构清单 ④ + 像素 ④-2 batch60/61）、00-README 行 ~119。
 *
 * 三条负结论（别实现）：
 *   1. **这不是 Dialog**：没有遮罩、没有 `--dismiss-on-mask`，z 只有 99。加遮罩会让形态变错。
 *   2. **这里的「复制链接」不带密码**。带密码的复制在二级权限 Dialog 的加密链接块里
 *      （04 §4.1.1 ⑤-4），一级面板没有密码入口。
 *   3. **成员列表 / 组织范围不做真实 CRUD**。04 §4.1 ② 只采到「+2 头像聚合」与一个邀请
 *      输入框；组织列表属于宿主数据，本库只留 `shareOrgName` 一个字符串位。
 */
import PermissionDialog from './PermissionDialog.vue'

export default {
  name: 'LarkDocSharePopover',
  components: { PermissionDialog },
  props: {
    ed: { type: Object, required: true },
  },
}
</script>
