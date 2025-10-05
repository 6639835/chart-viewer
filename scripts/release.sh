#!/bin/bash

# Chart Viewer Release Script
# 用于创建新版本并触发自动构建

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Chart Viewer Release Script${NC}"
echo "================================"

# 检查是否在 git 仓库中
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    echo -e "${RED}错误: 不在 git 仓库中${NC}"
    exit 1
fi

# 检查是否有未提交的更改
if [[ -n $(git status -s) ]]; then
    echo -e "${YELLOW}警告: 存在未提交的更改${NC}"
    git status -s
    read -p "是否继续? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# 获取当前版本
current_version=$(node -p "require('./package.json').version")
echo -e "当前版本: ${GREEN}${current_version}${NC}"

# 选择版本类型
echo ""
echo "选择版本类型:"
echo "  1) patch (修复 bug, 小改动)"
echo "  2) minor (新功能, 向后兼容)"
echo "  3) major (重大更改, 可能不兼容)"
echo "  4) prerelease (预发布版本: alpha/beta/rc)"
echo "  5) 自定义版本号"
echo ""
read -p "请选择 (1-5): " version_type

case $version_type in
    1)
        version_bump="patch"
        ;;
    2)
        version_bump="minor"
        ;;
    3)
        version_bump="major"
        ;;
    4)
        echo ""
        echo "选择预发布类型:"
        echo "  1) alpha"
        echo "  2) beta"
        echo "  3) rc (release candidate)"
        read -p "请选择 (1-3): " pre_type
        
        case $pre_type in
            1) pre_id="alpha" ;;
            2) pre_id="beta" ;;
            3) pre_id="rc" ;;
            *)
                echo -e "${RED}无效选择${NC}"
                exit 1
                ;;
        esac
        
        version_bump="prerelease"
        version_args="--preid=$pre_id"
        ;;
    5)
        read -p "输入版本号 (例如 1.2.3): " custom_version
        if [[ ! $custom_version =~ ^[0-9]+\.[0-9]+\.[0-9]+(-.*)?$ ]]; then
            echo -e "${RED}无效的版本号格式${NC}"
            exit 1
        fi
        version_bump=""
        ;;
    *)
        echo -e "${RED}无效选择${NC}"
        exit 1
        ;;
esac

# 更新版本号
echo ""
if [[ -n $version_bump ]]; then
    new_version=$(npm version $version_bump $version_args --no-git-tag-version)
else
    npm version $custom_version --no-git-tag-version
    new_version="v$custom_version"
fi

echo -e "新版本: ${GREEN}${new_version}${NC}"

# 更新日志 (可选)
read -p "是否编辑更新日志? (y/N) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    ${EDITOR:-vi} CHANGELOG.md
fi

# 确认发布
echo ""
echo -e "${YELLOW}即将执行以下操作:${NC}"
echo "  1. 提交版本更改"
echo "  2. 创建标签: $new_version"
echo "  3. 推送到远程仓库"
echo "  4. 触发 GitHub Actions 自动构建"
echo ""
read -p "确认发布? (y/N) " -n 1 -r
echo

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    # 恢复版本号
    git checkout package.json package-lock.json 2>/dev/null || true
    echo -e "${YELLOW}已取消发布${NC}"
    exit 1
fi

# 提交更改
git add package.json package-lock.json
git commit -m "chore: bump version to ${new_version}"

# 创建标签
git tag -a $new_version -m "Release ${new_version}"

# 推送到远程
echo ""
echo -e "${GREEN}推送到远程仓库...${NC}"
git push
git push --tags

echo ""
echo -e "${GREEN}✓ 发布成功!${NC}"
echo ""
echo "GitHub Actions 正在构建中..."
echo "查看进度: https://github.com/$(git remote get-url origin | sed 's/.*github.com[:/]\(.*\)\.git/\1/')/actions"
echo ""
echo "构建完成后，安装包将自动上传到: https://github.com/$(git remote get-url origin | sed 's/.*github.com[:/]\(.*\)\.git/\1/')/releases"
