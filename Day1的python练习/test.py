print("Hello World")
print(123.456)    # 数学写法
print(1.23456e2)  # 科学计数法
"""
海象运算符

Version: 1.0
Author: 骆昊
"""
# SyntaxError: invalid syntax
# print((a = 10))
# 海象运算符
print((a := 10))  # 10
print(a)   
flag0 = 1 == 1
flag1 = 3 > 2
flag2 = 2 < 1
flag3 = flag1 and flag2
flag4 = flag1 or flag2
flag5 = not flag0
print('flag0 =', flag0)     # flag0 = True
print('flag1 =', flag1)     # flag1 = True
print('flag2 =', flag2)     # flag2 = False
print('flag3 =', flag3)     # flag3 = False
print('flag4 =', flag4)     # flag4 = True
print('flag5 =', flag5)     # flag5 = False
print(flag1 and not flag2)  # True
print(1 > 2 or 2 == 3)      # False     # 10
"""
将华氏温度转换为摄氏温度

Version: 1.0
Author: 骆昊
"""
f = float(input('请输入华氏温度: '))
c = (f - 32) / 1.8
print('%.1f华氏度 = %.1f摄氏度' % (f, c))