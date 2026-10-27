/**
 * Validação de regras dimensionais técnicas para determinação de rotas e postos de trabalho.
 * Baseada na Tabela Técnica Oficial da fábrica Metalrib.
 */

/**
 * Verifica se uma porta exige o posto "Montagem Portas Emendadas"
 * com base na matriz dimensional oficial (modelo, temperatura e limites de altura/largura).
 *
 * REGRAS DA MATRIZ (TABELA TÉCNICA):
 * A) PORTAS DE CORRER (COR / CORRER):
 *    - Largura > 1300 mm (qualquer espessura/temperatura)
 *    - Altura > 2825 mm (se Resfriados / RESF)
 *    - Altura > 2745 mm (se Congelados / CONG)
 *    - Altura > 2705 mm (se Supercongelados / SUPER / SCONG)
 *
 * B) PORTAS DE GIRO (GIR / GIRO / GIRATÓRIA):
 *    - Largura > 1350 mm (qualquer espessura/temperatura)
 *    - Altura > 2900 mm (se Resfriados / RESF)
 *    - Altura > 2820 mm (se Congelados / CONG)
 *    - Altura > 2780 mm (se Supercongelados / SUPER / SCONG)
 */
export function verificarSeExigeEmenda(descricao: string): boolean {
  if (!descricao) return false;

  const descUpper = descricao.toUpperCase().replace(/\./g, '');

  // Se já contiver termo explícito de emenda na descrição
  if (/EMENDAD[AO]|EME-|\bEME\b/.test(descUpper)) {
    return true;
  }

  // 1. Extração de Altura e Largura (ex: "2100A X 1400L", "2100 X 1400", "2100ALT X 1400LARG")
  let altura = 0;
  let largura = 0;

  const matchAlt = descUpper.match(/(\d{3,4})\s*(A|ALT|ALTURA)/);
  const matchLarg = descUpper.match(/(\d{3,4})\s*(L|LARG|LARGURA)/);

  if (matchAlt && matchLarg) {
    altura = parseInt(matchAlt[1], 10);
    largura = parseInt(matchLarg[1], 10);
  } else {
    const matchDimensoes = descUpper.match(/(\d{3,4})\s*[Xx*]\s*(\d{3,4})/);
    if (matchDimensoes) {
      // Por padrão em portas industriais: primeira dimensão costuma ser altura, segunda largura
      altura = parseInt(matchDimensoes[1], 10);
      largura = parseInt(matchDimensoes[2], 10);
    }
  }

  if (!altura && !largura) return false;

  // 2. Identificação do Modelo (Correr vs Giro)
  const isCorrer = /COR|CORRER/.test(descUpper);
  const isGiro = /GIR|GIRO|GIRATORIA/.test(descUpper);

  // 3. Identificação da Temperatura / Espessura
  const isSuper = /SUPER|SCONG/.test(descUpper);
  const isCong = /CONG|CONGELAD/.test(descUpper) && !isSuper;
  const isResf = /RESF|RESFRIAD/.test(descUpper) || (!isSuper && !isCong);

  // 4. Aplicação da Tabela Técnica Oficial
  if (isCorrer) {
    if (largura > 1300) return true;
    if (isSuper && altura > 2705) return true;
    if (isCong && altura > 2745) return true;
    if (isResf && altura > 2825) return true;
  } else if (isGiro) {
    if (largura > 1350) return true;
    if (isSuper && altura > 2780) return true;
    if (isCong && altura > 2820) return true;
    if (isResf && altura > 2900) return true;
  } else {
    // Caso genérico: adota o limite conservador
    if (largura > 1300 || altura > 2705) return true;
  }

  return false;
}

/**
 * Retorna as etapas oficiais da rota de fabricação de Trilhos de Portas de Correr.
 */
export function getRotaTrilhoCorrer(): string[] {
  return [
    'Corte de Trilho p/ Porta Correr',
    'Montagem de Trilho p/ Porta Correr'
  ];
}

/**
 * Validação sequencial e verificação de compatibilidade para Ordens de Produção de Trilhos.
 * Impede que produtos que não sejam trilhos usem os postos de trilho,
 * restringe OPs de trilhos aos postos permitidos,
 * e exige a conclusão do Corte antes do início da Montagem.
 */
export function validarPostoTrilho(
  op: any,
  postoSelecionado: string,
  apontamentos?: any[]
): { valido: boolean; motivo?: string } {
  const isTrilho = (op?.descricao || '').toUpperCase().includes('TRILHO') || 
                   String(op?.codigo || op?.codigoProduto || '').startsWith('028.');

  // Se NÃO for trilho, não pode selecionar postos exclusivos de trilho
  if (!isTrilho) {
    if (postoSelecionado.includes('Trilho p/ Porta Correr')) {
      return { valido: false, motivo: 'Este posto é exclusivo para fabricação de Trilhos de Portas de Correr.' };
    }
    return { valido: true };
  }

  // Se FOR trilho, só pode selecionar postos da rota de trilho
  const rotaTrilho = getRotaTrilhoCorrer();
  if (!rotaTrilho.includes(postoSelecionado)) {
    return { valido: false, motivo: 'OP de Trilho só pode ser apontada nos postos de Corte ou Montagem de Trilho.' };
  }

  // Validação Sequencial: Montagem só libera se Corte estiver concluído
  if (postoSelecionado === 'Montagem de Trilho p/ Porta Correr') {
    const cortePostoKey = 'Corte de Trilho p/ Porta Correr';
    const corteProgresso = op?.progressoPostos?.[cortePostoKey]?.concluido;
    const corteEtapaArray = Array.isArray(op?.etapas) && op.etapas.find((e: any) => e.nome === cortePostoKey || e.step === cortePostoKey)?.concluido;
    const corteEtapaRecord = op?.etapas?.[cortePostoKey];
    const corteRecordConcluido = corteEtapaRecord?.status === 'CONCLUIDO' || 
      (typeof corteEtapaRecord?.concluidas === 'number' && corteEtapaRecord.concluidas > 0 && corteEtapaRecord.concluidas >= (corteEtapaRecord.total || 1));

    const corteAptConcluido = Array.isArray(apontamentos) && apontamentos.some(
      (a: any) =>
        (a.op_numero === op?.op_numero || a.op === op?.op_numero) &&
        (a.etapa_rota === cortePostoKey || a.etapaRota === cortePostoKey || a.setor === cortePostoKey || a.setorFisico === cortePostoKey) &&
        a.status === 'FINALIZADO'
    );

    const corteConcluido = Boolean(corteProgresso || corteEtapaArray || corteRecordConcluido || corteAptConcluido);
    if (!corteConcluido) {
      return { valido: false, motivo: 'A Montagem do Trilho só pode ser iniciada após a conclusão do Corte do Trilho.' };
    }
  }

  return { valido: true };
}
