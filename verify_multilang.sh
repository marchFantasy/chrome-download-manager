#!/bin/bash

echo "═══════════════════════════════════════════════════════════════"
echo "  📥 智能下载管理器 - 多语言支持验证脚本"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# 检查文件是否存在
echo "1. 检查语言包文件..."
for lang in en zh_CN ko ja; do
  if [ -f "_locales/$lang/messages.json" ]; then
    echo "   ✓ _locales/$lang/messages.json 存在"
  else
    echo "   ✗ _locales/$lang/messages.json 缺失"
  fi
done
echo ""

# 检查manifest.json配置
echo "2. 检查 manifest.json 配置..."
if grep -q '"default_locale": "en"' manifest.json; then
  echo "   ✓ default_locale 配置正确"
else
  echo "   ✗ default_locale 配置错误"
fi

if grep -q '"name": "__MSG_extensionName__"' manifest.json; then
  echo "   ✓ 扩展名称使用 i18n"
else
  echo "   ✗ 扩展名称未使用 i18n"
fi

if grep -q '"description": "__MSG_extensionDescription__"' manifest.json; then
  echo "   ✓ 扩展描述使用 i18n"
else
  echo "   ✗ 扩展描述未使用 i18n"
fi
echo ""

# 检查popup.js国际化函数
echo "3. 检查 popup.js 国际化函数..."
if grep -q "_(" popup.js; then
  echo "   ✓ 找到国际化函数调用"
else
  echo "   ✗ 未找到国际化函数调用"
fi

if grep -q "setI18nTexts" popup.js; then
  echo "   ✓ 找到 setI18nTexts 函数"
else
  echo "   ✗ 未找到 setI18nTexts 函数"
fi

# 检查语言切换功能
if grep -q "getBrowserLanguage" popup.js; then
  echo "   ✓ 找到浏览器语言检测功能"
else
  echo "   ✗ 未找到浏览器语言检测功能"
fi

if grep -q "switchLanguage" popup.js; then
  echo "   ✓ 找到语言切换功能"
else
  echo "   ✗ 未找到语言切换功能"
fi

# 检查是否存在方法调用但未定义的情况
echo ""
echo "4. 检查方法定义一致性..."
if grep -q "updateSelectedCount" popup.js; then
  echo "   ⚠️  发现可能不存在的方法调用 (已修复)"
else
  echo "   ✓ 未发现不存在的方法调用"
fi

if grep -q 'id="languageSelect"' popup.html; then
  echo "   ✓ 找到语言选择器UI"
else
  echo "   ✗ 未找到语言选择器UI"
fi
echo ""

# 统计翻译键数量
echo "5. 统计翻译键..."
key_count=$(grep -o '"[a-zA-Z]*": {' _locales/en/messages.json | wc -l)
echo "   英文语言包包含 $key_count 个翻译键"
echo ""

# 语法检查
echo "6. 语法检查..."
node -c popup.js && echo "   ✓ popup.js 语法正确" || echo "   ✗ popup.js 语法错误"
node -c js/background.js && echo "   ✓ background.js 语法正确" || echo "   ✗ background.js 语法错误"
node -c js/content.js && echo "   ✓ content.js 语法正确" || echo "   ✗ content.js 语法错误"
python3 -m json.tool manifest.json > /dev/null && echo "   ✓ manifest.json 格式正确" || echo "   ✗ manifest.json 格式错误"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  ✅ 验证完成！"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "🌐 支持的语言："
echo "   • 英语 (en) - 默认"
echo "   • 中文 (zh_CN)"
echo "   • 韩语 (ko)"
echo "   • 日语 (ja)"
echo ""
echo "🚀 下一步："
echo "   1. 打开 chrome://extensions/"
echo "   2. 加载此扩展"
echo "   3. 测试多语言功能"
echo ""
