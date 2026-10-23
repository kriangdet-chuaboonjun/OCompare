/* ==========================================================
   CR Exp 2026-10 : EPObjective (head ของ EP) - รวมทุกอย่างในไฟล์เดียว
   ========================================================== */
ALTER TABLE dbo.bcpg_ep_header ADD EPObjective nvarchar(2000) NULL
GO
ALTER PROCEDURE dbo.BCPG_EP_insert_ep_item
    @EPID int,
    @Name nvarchar(100)
AS
BEGIN
    SET NOCOUNT ON;
    INSERT INTO dbo.ep_item (EPID, Name) VALUES (@EPID, @Name);
END
GO
-- end of file
