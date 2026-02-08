/**
 * 这是一个测试文件，用于验证 Git Blame Inline 插件功能
 * 
 * 测试步骤：
 * 1. 按 F5 启动扩展开发窗口
 * 2. 在新窗口中打开这个文件
 * 3. 查看每行代码末尾是否显示灰色的 blame 信息
 * 4. 将鼠标悬停在代码上，查看是否显示完整的 commit 详情
 */

export function testFunction() {
  console.log('这是一个测试函数');
  return true;
}

export class TestClass {
  private value: string;

  constructor(value: string) {
    this.value = value;
  }

  getValue(): string {
    return this.value;
  }

  setValue(newValue: string): void {
    this.value = newValue;
  }
}

// 测试数组操作
const numbers = [1, 2, 3, 4, 5];
const doubled = numbers.map(n => n * 2);
console.log(doubled);

// 测试异步函数
async function asyncTest() {
  await new Promise(resolve => setTimeout(resolve, 1000));
  console.log('异步操作完成');
}

asyncTest();
