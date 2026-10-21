-- 10-21 试用反馈第四轮 H1-3（契约 3.27）：拍一拍后缀（「拍了拍我的小脑袋」里的「的小脑袋」），用户在「我 › 个人信息 › 拍一拍」设置。
ALTER TABLE identity.profiles ADD COLUMN nudge_suffix text;
ALTER TABLE identity.profiles ADD CONSTRAINT profiles_nudge_suffix_length CHECK (char_length(nudge_suffix) <= 15);
